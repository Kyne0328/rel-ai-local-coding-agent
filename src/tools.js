const fs = require("node:fs");
const path = require("node:path");
const { readConfig, resolveWorkspace, publicConfigSummary } = require("./config");
const { collectTextFiles, readTextFileSafe, writeTextFileSafe, resolveSafePath, fileSha256 } = require("./safety");
const { runProcess, summarizeCommand } = require("./process");
const { logAudit, readAudit } = require("./audit");
const sessions = require("./sessions");
const {
  runGit,
  currentBranch,
  gitStatus,
  gitDiff,
  gitLog,
  gitShow,
  applyPatch,
  applyPatchAndRun,
  createBranch,
  switchBranch,
  commitAll,
  pushBranch,
  createPrWithGh,
  prChecksWithGh,
  runConfiguredCommand
} = require("./git");
const { createTaskWorktree, listWorktrees, removeTaskWorktree, workspaceFromSession } = require("./worktrees");
const { startCommandJob, jobStatus, listJobs, cancelJob } = require("./jobs");
const { runDocker } = require("./docker");
const approvals = require("./approvals");
const plans = require("./plans");
const indexer = require("./indexer");
const locks = require("./locks");
const orchestrator = require("./orchestrator");
const taskRunner = require("./taskRunner");
const multiagent = require("./multiagent");
const scheduler = require("./scheduler");
const mergeCoordinator = require("./mergeCoordinator");
const memory = require("./memory");
const snapshots = require("./snapshots");
const review = require("./review");
const semantic = require("./semantic");
const prWorkflow = require("./prWorkflow");
const doctor = require("./doctor");
const policy = require("./policy");
const productUx = require("./productUx");
const { enforcePermission } = require("./permissions");
const pkg = require("../package.json");

const toolSchemas = [
  tool("relai_version", "Version Info", "Return rel-ai-mcp version, runtime, and server capabilities.", {}),
  tool("relai_config", "Rel.AI MCP Config Summary", "Return active config path, limits, workspace aliases, command keys, and safety switches. Does not reveal secrets.", {}),
  tool("relai_audit_tail", "Audit Log Tail", "Return recent rel-ai-mcp audit entries.", { limit: numberProp(1, 1000) }),
  tool("relai_dashboard_summary", "Dashboard Summary", "Return sessions, jobs, approvals, locks, and config summary for a lightweight web dashboard.", { limit: numberProp(1, 200) }),
  tool("relai_dashboard_open", "Dashboard Open Info", "Return dashboard and API URLs for a running Rel.AI MCP HTTP server.", { baseUrl: stringProp() }),
  tool("relai_dashboard_data", "Dashboard Data", "Return rich v9 dashboard data: sessions, jobs, approvals, locks, health, multi-agent status, and audit tail.", { limit: numberProp(1, 500) }),
  tool("relai_live_log_tail", "Live Log Tail", "Return recent audit entries for live-log/dashboard views.", { limit: numberProp(1, 1000) }),
  tool("relai_health_monitor", "Health Monitor", "Check state directories, configured workspaces, stale jobs, stale locks, approvals, and worktree availability.", { limit: numberProp(1, 500) }),
  tool("relai_cleanup_preview", "Cleanup Preview", "Preview old state files that cleanup would remove. Does not delete files.", { olderThanHours: numberProp(1, 8760), maxDeletes: numberProp(1, 5000), includeAudit: boolProp() }),
  tool("relai_cleanup_run", "Cleanup Run", "Delete old generated state files. Requires confirm=true and admin permission profile.", { olderThanHours: numberProp(1, 8760), maxDeletes: numberProp(1, 5000), includeAudit: boolProp(), confirm: boolProp() }, ["confirm"]),
  tool("relai_doctor_fix", "Doctor Fix", "Apply safe local fixes such as state directory creation and LF-normalization files for a workspace.", { workspacePath: stringProp(), overwrite: boolProp(), renormalize: boolProp() }),
  tool("relai_setup_wizard", "Setup Wizard", "Generate a first-run setup plan, suggested config, token, and commands for onboarding.", { alias: stringProp(), workspacePath: stringProp(), generateToken: boolProp() }),
  tool("relai_import_original_relai_config", "Import Original Rel.AI Config", "Import workspace aliases and test commands from the original ~/.rel-ai/opencode.json config.", { sourcePath: stringProp(), dryRun: boolProp() }),
  tool("relai_state_export", "Export Rel.AI MCP State", "Export JSON state files for backup or migration.", { outputPath: stringProp(), maxFiles: numberProp(1, 20000), maxFileBytes: numberProp(1000, 10485760) }),
  tool("relai_state_import", "Import Rel.AI MCP State", "Import a JSON state export. Requires confirm=true and admin permission profile.", { inputPath: stringProp(), payload: objectProp(), confirm: boolProp() }, ["confirm"]),


  tool("relai_scheduler_start", "Start Multi-Agent Scheduler", "Create a dependency-aware scheduler record and compute which subtasks can run now.", { parentSessionId: stringProp(), schedulerId: stringProp(), maxParallel: numberProp(1, 50), limit: numberProp(1, 1000) }),
  tool("relai_scheduler_status", "Scheduler Status", "Read scheduler status and current runnable/blocked subtask sets.", { parentSessionId: stringProp(), schedulerId: stringProp(), maxParallel: numberProp(1, 50), limit: numberProp(1, 1000) }),
  tool("relai_scheduler_pause", "Pause Scheduler", "Mark a scheduler record as paused.", { schedulerId: stringProp(), reason: stringProp() }),
  tool("relai_scheduler_resume", "Resume Scheduler", "Mark a scheduler record as active.", { schedulerId: stringProp(), reason: stringProp() }),
  tool("relai_scheduler_stop", "Stop Scheduler", "Mark a scheduler record as stopped.", { schedulerId: stringProp(), reason: stringProp() }),

  tool("relai_merge_plan", "Plan Multi-Agent Merge", "Create a safe merge order for completed/reviewed subtasks and detect changed-file conflicts.", { workspace: stringProp(), parentSessionId: stringProp(), targetBranch: stringProp() }, ["workspace"]),
  tool("relai_merge_execute", "Execute Multi-Agent Merge", "Execute the computed merge plan. Dry-run by default; non-dry-run requires merge approval.", { workspace: stringProp(), parentSessionId: stringProp(), targetBranch: stringProp(), dryRun: boolProp(), force: boolProp(), stopOnFailure: boolProp(), message: stringProp(), approvalId: stringProp() }, ["workspace"]),
  tool("relai_merge_abort", "Abort Git Merge", "Run git merge --abort in a workspace or task worktree.", { workspace: stringProp(), sessionId: stringProp(), approvalId: stringProp() }, ["workspace"]),
  tool("relai_merge_status", "Merge Status", "Show merge status and optional merge plan summary.", { workspace: stringProp(), sessionId: stringProp(), parentSessionId: stringProp() }, ["workspace"]),

  tool("relai_memory_read", "Read Repository Memory", "Read safe local repository memory notes for a workspace.", { workspace: stringProp() }, ["workspace"]),
  tool("relai_memory_write", "Write Repository Memory", "Append a safe local repository memory note such as conventions, architecture notes, or known flaky tests.", { workspace: stringProp(), type: stringProp(), title: stringProp(), text: stringProp(), tags: arrayProp("string", 0, 30) }, ["workspace", "title", "text"]),
  tool("relai_memory_search", "Search Repository Memory", "Search safe local repository memory notes.", { workspace: stringProp(), query: stringProp(), limit: numberProp(1, 200) }, ["workspace"]),
  tool("relai_memory_clear", "Clear Repository Memory", "Clear local repository memory for one workspace. Requires confirm=true.", { workspace: stringProp(), confirm: boolProp() }, ["workspace", "confirm"]),

  tool("relai_review_score", "Review Risk Score", "Score the current diff for risk, changed-file breadth, secret-like tokens, and test coverage gaps.", { workspace: stringProp(), sessionId: stringProp(), staged: boolProp(), goal: stringProp(), includeDiff: boolProp() }, ["workspace"]),
  tool("relai_review_security", "Review Security Risks", "Run security-focused heuristic review over the current diff.", { workspace: stringProp(), sessionId: stringProp(), staged: boolProp(), goal: stringProp(), includeDiff: boolProp() }, ["workspace"]),
  tool("relai_review_test_gaps", "Review Test Gaps", "Detect likely missing test coverage from current diff and task goal.", { workspace: stringProp(), sessionId: stringProp(), staged: boolProp(), goal: stringProp(), includeDiff: boolProp() }, ["workspace"]),
  tool("relai_review_regression_risks", "Review Regression Risks", "Detect likely regression risks from current diff.", { workspace: stringProp(), sessionId: stringProp(), staged: boolProp(), goal: stringProp(), includeDiff: boolProp() }, ["workspace"]),

  tool("relai_snapshot_create", "Create Workspace Snapshot", "Capture HEAD, branch, status, staged diff, and unstaged diff before risky actions.", { workspace: stringProp(), sessionId: stringProp(), title: stringProp(), summary: stringProp() }, ["workspace"]),
  tool("relai_snapshot_list", "List Workspace Snapshots", "List stored workspace snapshots.", { workspace: stringProp(), limit: numberProp(1, 1000) }),
  tool("relai_snapshot_read", "Read Workspace Snapshot", "Read a stored workspace snapshot with diffs.", { snapshotId: stringProp() }, ["snapshotId"]),
  tool("relai_snapshot_restore", "Restore Workspace Snapshot", "Restore a stored snapshot. Dry-run by default; non-dry-run requires reset approval.", { workspace: stringProp(), sessionId: stringProp(), snapshotId: stringProp(), dryRun: boolProp(), allowDifferentHead: boolProp(), approvalId: stringProp() }, ["workspace", "snapshotId"]),
  tool("relai_snapshot_delete", "Delete Workspace Snapshot", "Delete a stored snapshot record.", { snapshotId: stringProp() }, ["snapshotId"]),

  tool("relai_semantic_index_build", "Build Semantic-ish Index", "Build an optional local token-frequency index for better relevant-file retrieval without external embeddings.", { workspace: stringProp(), sessionId: stringProp(), maxFiles: numberProp(1, 100000), maxFileBytes: numberProp(1000, 5242880) }, ["workspace"]),
  tool("relai_semantic_search", "Semantic-ish Search", "Search the optional local token-frequency index.", { workspace: stringProp(), sessionId: stringProp(), query: stringProp(), terms: stringProp(), limit: numberProp(1, 200) }, ["workspace"]),
  tool("relai_context_recommend", "Recommend Context", "Recommend files to read for a task using the optional local semantic-ish index.", { workspace: stringProp(), sessionId: stringProp(), goal: stringProp(), task: stringProp(), terms: arrayProp("string", 0, 30), limit: numberProp(1, 200) }, ["workspace"]),

  tool("relai_pr_comments_read", "Read PR Comments", "Read PR comments/reviews through GitHub CLI for requested-changes workflows.", { workspace: stringProp(), pr: stringProp(), sessionId: stringProp() }, ["workspace"]),
  tool("relai_pr_requested_changes_plan", "Plan Requested Changes", "Turn PR review comments into a safe fix plan skeleton.", { workspace: stringProp(), pr: stringProp(), comments: objectProp(), review: objectProp(), sessionId: stringProp() }, ["workspace"]),
  tool("relai_pr_reply_to_review", "Reply To PR Review", "Post a PR comment through GitHub CLI after applying requested changes.", { workspace: stringProp(), pr: stringProp(), body: stringProp(), message: stringProp(), sessionId: stringProp(), approvalId: stringProp() }, ["workspace"]),

  tool("relai_doctor", "Run Rel.AI MCP Doctor", "Check Node/Git/GitHub/Docker availability, config safety, and optional line-ending setup.", { workspacePath: stringProp(), checkGh: boolProp(), checkDocker: boolProp() }),
  tool("relai_policy_summary", "Policy Summary", "Return effective safety policy, approval gates, and recommendations.", {}),
  tool("relai_policy_evaluate", "Evaluate Policy", "Evaluate whether a proposed action is allowed or approval-gated.", { action: stringProp(), workspace: stringProp(), sessionId: stringProp(), commandKey: stringProp() }, ["action"]),

  tool("relai_task_run", "Run Codex-like Task", "High-level task runner: create/resume a task session, create worktree, build index, create plan, apply supplied patches, run tests, and optionally prepare a PR.", {
    workspace: stringProp(), sessionId: stringProp(), goal: stringProp(), task: stringProp(), mode: stringProp(), title: stringProp(), branchName: stringProp(), fromRef: stringProp(), createWorktree: boolProp(), buildIndex: boolProp(), maxIndexFiles: numberProp(1, 100000), forceNewPlan: boolProp(), patches: arrayProp("string", 0, 20), testCommandKeys: arrayProp("string", 0, 30), stopOnFailure: boolProp(), commitMessage: stringProp(), push: boolProp(), remote: stringProp(), createPr: boolProp(), prTitle: stringProp(), prBody: stringProp(), prBodyExtra: stringProp(), base: stringProp(), head: stringProp(), draft: boolProp(), labels: arrayProp("string", 0, 20), reviewers: arrayProp("string", 0, 20), steps: arrayProp("object", 0, 200)
  }, ["workspace"]),
  tool("relai_task_status", "Read Codex-like Task Status", "Read task session status, related plans, and orchestration metadata.", { sessionId: stringProp() }, ["sessionId"]),
  tool("relai_task_stop", "Stop Codex-like Task", "Mark a task session as stopped and append a control step.", { sessionId: stringProp(), reason: stringProp() }, ["sessionId"]),
  tool("relai_task_resume", "Resume Codex-like Task", "Mark a stopped/paused task session as active again.", { sessionId: stringProp(), note: stringProp() }, ["sessionId"]),

  tool("relai_task_split", "Split Task Into Agent Subtasks", "Create role-based or user-defined subtasks under a parent session for multi-agent execution.", {
    workspace: stringProp(), sessionId: stringProp(), goal: stringProp(), task: stringProp(), strategy: stringProp(), count: numberProp(1, 12), maxSubtasks: numberProp(1, 50), subtasks: arrayProp("object", 0, 50), branchPrefix: stringProp(), createWorktrees: boolProp(), fromRef: stringProp()
  }, ["workspace"]),
  tool("relai_subtask_create", "Create Agent Subtask", "Create a persistent subtask with its own role, session, and optional isolated worktree.", {
    workspace: stringProp(), parentSessionId: stringProp(), role: stringProp(), title: stringProp(), goal: stringProp(), dependsOn: arrayProp("string", 0, 50), branchName: stringProp(), createSession: boolProp(), createWorktree: boolProp(), fromRef: stringProp()
  }, ["workspace", "title"]),
  tool("relai_subtask_list", "List Agent Subtasks", "List multi-agent subtasks, optionally scoped by parent session or status.", { parentSessionId: stringProp(), status: stringProp(), limit: numberProp(1, 1000) }),
  tool("relai_subtask_read", "Read Agent Subtask", "Read a persistent multi-agent subtask record.", { subtaskId: stringProp() }, ["subtaskId"]),
  tool("relai_subtask_run", "Run Agent Subtask", "Run one subtask through the high-level task runner using the role's default mode or an explicit mode.", {
    workspace: stringProp(), subtaskId: stringProp(), mode: stringProp(), createWorktree: boolProp(), buildIndex: boolProp(), branchName: stringProp(), fromRef: stringProp(), patches: arrayProp("string", 0, 20), testCommandKeys: arrayProp("string", 0, 30), stopOnFailure: boolProp(), commitMessage: stringProp(), push: boolProp(), createPr: boolProp(), ignoreDependencies: boolProp()
  }, ["workspace", "subtaskId"]),
  tool("relai_subtask_merge_back", "Merge Agent Subtask Back", "Preflight or merge a completed subtask branch back to a target branch. Dry-run is default.", {
    workspace: stringProp(), subtaskId: stringProp(), sourceBranch: stringProp(), targetBranch: stringProp(), dryRun: boolProp(), message: stringProp(), approvalId: stringProp()
  }, ["workspace", "subtaskId"]),
  tool("relai_conflict_check", "Check Multi-Agent Conflicts", "Detect changed-file overlap across subtasks before merge-back.", {
    workspace: stringProp(), parentSessionId: stringProp(), subtaskIds: arrayProp("string", 0, 100)
  }, ["workspace"]),
  tool("relai_agent_review_diff", "Agent Review Current Diff", "Run a reviewer-style heuristic pass over the current diff or a git revision.", {
    workspace: stringProp(), sessionId: stringProp(), staged: boolProp(), rev: stringProp(), largeDiffThreshold: numberProp(1, 100000)
  }, ["workspace"]),
  tool("relai_pr_review_summary", "Summarize Pull Request For Review", "Use GitHub CLI to summarize PR metadata, checks, diff risk, and review checklist.", {
    workspace: stringProp(), pr: stringProp(), sessionId: stringProp(), largeDiffThreshold: numberProp(1, 100000)
  }, ["workspace"]),
  tool("relai_agent_review_pr", "Agent Review Pull Request", "Record a reviewer-agent summary of a pull request and its checks.", {
    workspace: stringProp(), pr: stringProp(), sessionId: stringProp(), largeDiffThreshold: numberProp(1, 100000)
  }, ["workspace"]),
  tool("relai_task_graph", "Read Multi-Agent Task Graph", "Return parent session, plans, subtasks, and dependency edges for dashboard/task graph views.", { sessionId: stringProp(), parentSessionId: stringProp() }),
  tool("relai_multiagent_status", "Read Multi-Agent Status", "Return multi-agent subtask status counts and summaries.", { parentSessionId: stringProp(), status: stringProp(), limit: numberProp(1, 1000) }),

  tool("relai_approval_request", "Request Approval Gate", "Create a pending approval record for gated write, patch, command, Docker, commit, push, PR, reset, or worktree-removal actions.", {
    action: stringProp(), workspace: stringProp(), sessionId: stringProp(), summary: stringProp(), data: objectProp()
  }, ["action", "summary"]),
  tool("relai_approval_read", "Read Approval Gate", "Read a single approval record.", { approvalId: stringProp() }, ["approvalId"]),
  tool("relai_approval_list", "List Approval Gates", "List approval records, optionally by status.", { status: stringProp(), limit: numberProp(1, 500) }),
  tool("relai_approval_resolve", "Resolve Approval Gate", "Approve, reject, or cancel an approval record.", {
    approvalId: stringProp(), status: stringProp(), note: stringProp()
  }, ["approvalId", "status"]),
  tool("relai_approval_grant", "Grant Approval", "Approve a pending one-time approval gate.", { approvalId: stringProp(), note: stringProp() }, ["approvalId"]),
  tool("relai_approval_deny", "Deny Approval", "Reject a pending one-time approval gate.", { approvalId: stringProp(), note: stringProp() }, ["approvalId"]),
  tool("relai_approval_status", "Approval Status", "Read a pending/resolved approval gate status.", { approvalId: stringProp() }, ["approvalId"]),

  tool("relai_plan_create", "Create Task Plan", "Create a persistent multi-step implementation plan attached to an optional task session.", {
    sessionId: stringProp(), workspace: stringProp(), title: stringProp(), goal: stringProp(), steps: arrayProp("object", 0, 200), risks: arrayProp("string", 0, 100), validation: arrayProp("string", 0, 100)
  }, ["goal"]),
  tool("relai_plan_list", "List Task Plans", "List recent plans, optionally scoped to a task session.", { sessionId: stringProp(), limit: numberProp(1, 500) }),
  tool("relai_plan_read", "Read Task Plan", "Read a full persistent task plan.", { planId: stringProp() }, ["planId"]),
  tool("relai_plan_update", "Update Task Plan", "Update plan title, goal, status, risks, or validation list.", {
    planId: stringProp(), status: stringProp(), title: stringProp(), goal: stringProp(), risks: arrayProp("string", 0, 100), validation: arrayProp("string", 0, 100)
  }, ["planId"]),
  tool("relai_plan_step_update", "Update Task Plan Step", "Update the status/result/details of one plan step.", {
    planId: stringProp(), stepId: stringProp(), index: numberProp(1, 1000), status: stringProp(), title: stringProp(), details: stringProp(), resultSummary: stringProp(), data: objectProp()
  }, ["planId"]),
  tool("relai_plan_step_append", "Append Task Plan Step", "Append a new step to a persistent plan.", {
    planId: stringProp(), step: objectProp(), title: stringProp(), details: stringProp(), status: stringProp(), toolHint: stringProp()
  }, ["planId"]),

  tool("relai_task_start", "Start Coding Task Session", "Create a persistent Codex-like task session for planning, edits, tests, and PR tracking.", {
    workspace: stringProp(), goal: stringProp(), branch: stringProp()
  }, ["workspace", "goal"]),
  tool("relai_task_list", "List Coding Task Sessions", "List recent task sessions.", { limit: numberProp(1, 500) }),
  tool("relai_task_read", "Read Coding Task Session", "Read a task session with all recorded steps.", { sessionId: stringProp() }, ["sessionId"]),
  tool("relai_task_step", "Append Task Step", "Append a note, plan, test result, patch summary, or PR update to a task session.", {
    sessionId: stringProp(), type: stringProp(), title: stringProp(), details: stringProp(), data: objectProp()
  }, ["sessionId"]),
  tool("relai_task_update", "Update Task Session", "Update task session status, branch, or summary.", {
    sessionId: stringProp(), status: stringProp(), summary: stringProp(), branch: stringProp()
  }, ["sessionId"]),
  tool("relai_task_worktree_create", "Create Task Worktree", "Create an isolated git worktree for a task session and attach it to that session.", {
    sessionId: stringProp(), workspace: stringProp(), branchName: stringProp(), fromRef: stringProp()
  }, ["sessionId"]),
  tool("relai_task_worktree_remove", "Remove Task Worktree", "Remove a task session worktree after review/merge. Requires admin permission profile.", {
    sessionId: stringProp(), workspace: stringProp(), force: boolProp(), closeSession: boolProp(), approvalId: stringProp()
  }, ["sessionId"]),
  tool("relai_worktree_list", "List Git Worktrees", "List git worktrees for a configured workspace.", {
    workspace: stringProp()
  }, ["workspace"]),

  tool("relai_workspace_tree", "Workspace Tree", "Return a safe filtered file tree for a configured workspace alias or attached task worktree. Generated/cache folders and sensitive paths are skipped.", {
    workspace: stringProp(), sessionId: stringProp(), maxEntries: numberProp(1, 20000)
  }, ["workspace"]),
  tool("relai_workspace_profile", "Workspace Profile", "Detect common stack manifests and summarize likely package manager/test surface.", {
    workspace: stringProp(), sessionId: stringProp()
  }, ["workspace"]),
  tool("relai_read_files", "Read Workspace Files", "Read specific safe text files from a workspace or attached task worktree. Rejects traversal, secret-looking paths, large files, binary files, and escaping symlinks.", {
    workspace: stringProp(), sessionId: stringProp(), paths: arrayProp("string", 1, 100), includeSha256: boolProp()
  }, ["workspace", "paths"]),
  tool("relai_write_file", "Write Workspace Text File", "Create or replace a safe text file in a workspace or task worktree. Supports expectedSha256 optimistic locking.", {
    workspace: stringProp(), sessionId: stringProp(), path: stringProp(), content: stringProp(), expectedSha256: stringProp(), approvalId: stringProp()
  }, ["workspace", "path", "content"]),
  tool("relai_search", "Search Workspace Text", "Literal text search across safe text files.", {
    workspace: stringProp(), sessionId: stringProp(), query: stringProp(), maxMatches: numberProp(1, 500)
  }, ["workspace", "query"]),
  tool("relai_context_pack", "Build Focused Context Pack", "Build a focused coding context pack from explicit files plus search terms.", {
    workspace: stringProp(), sessionId: stringProp(), paths: arrayProp("string", 0, 100), searchTerms: arrayProp("string", 0, 20), maxSearchMatches: numberProp(1, 300), includeTree: boolProp()
  }, ["workspace"]),
  tool("relai_index_build", "Build Repository Index", "Build a cached repository index with file metadata, hashes, line counts, and simple symbol extraction.", {
    workspace: stringProp(), sessionId: stringProp(), maxFiles: numberProp(1, 100000), maxFileBytes: numberProp(1000, 5242880)
  }, ["workspace"]),
  tool("relai_index_stats", "Repository Index Stats", "Return stats for a previously built repository index.", {
    workspace: stringProp(), sessionId: stringProp()
  }, ["workspace"]),
  tool("relai_index_search", "Search Repository Index", "Search paths and extracted symbols in the cached repository index.", {
    workspace: stringProp(), sessionId: stringProp(), query: stringProp(), limit: numberProp(1, 500)
  }, ["workspace", "query"]),

  tool("relai_task_bootstrap", "Bootstrap Codex-like Task", "Create a task session, optional worktree, repository index, and initial implementation plan in one call.", {
    workspace: stringProp(), goal: stringProp(), title: stringProp(), branchName: stringProp(), fromRef: stringProp(), createWorktree: boolProp(), buildIndex: boolProp(), maxIndexFiles: numberProp(1, 100000), testCommandKeys: arrayProp("string", 0, 30), steps: arrayProp("object", 0, 200)
  }, ["workspace", "goal"]),
  tool("relai_issue_to_pr_bootstrap", "Bootstrap GitHub Issue To PR Task", "Use GitHub CLI to read an issue and create a session, worktree, index, and plan for a linked PR workflow.", {
    workspace: stringProp(), issue: stringProp(), issueNumber: stringProp(), branchName: stringProp(), fromRef: stringProp(), createWorktree: boolProp(), buildIndex: boolProp(), testCommandKeys: arrayProp("string", 0, 30)
  }, ["workspace"]),
  tool("relai_ci_repair_snapshot", "Capture CI Repair Snapshot", "Read PR checks through GitHub CLI and create a repair-oriented session note when checks fail.", {
    workspace: stringProp(), sessionId: stringProp(), pr: stringProp()
  }, ["workspace"]),
  tool("relai_ci_watch", "Watch CI Checks", "Poll GitHub PR checks and classify pass/fail/pending state.", {
    workspace: stringProp(), sessionId: stringProp(), pr: stringProp(), attempts: numberProp(1, 50), intervalSeconds: numberProp(1, 300)
  }, ["workspace"]),
  tool("relai_ci_repair_run", "Run CI Repair Loop", "Watch failing PR checks and optionally run an allowlisted repair command, commit, and push for a bounded number of cycles.", {
    workspace: stringProp(), sessionId: stringProp(), pr: stringProp(), maxCycles: numberProp(1, 10), watchAttempts: numberProp(1, 20), repairCommandKey: stringProp(), repairCommand: stringProp(), commitMessage: stringProp(), push: boolProp(), remote: stringProp(), branchName: stringProp()
  }, ["workspace"]),

  tool("relai_session_diff", "Task Session Diff", "Return the current diff for a task session worktree or workspace.", { workspace: stringProp(), sessionId: stringProp(), staged: boolProp() }, ["workspace"]),
  tool("relai_session_changed_files", "Task Session Changed Files", "Return changed files parsed from the current session/workspace diff.", { workspace: stringProp(), sessionId: stringProp(), staged: boolProp() }, ["workspace"]),
  tool("relai_session_test_summary", "Task Session Test Summary", "Return recent test/CI/check steps recorded in a task session.", { sessionId: stringProp(), limit: numberProp(1, 100) }, ["sessionId"]),
  tool("relai_session_export", "Export Task Session", "Export session, related plans, current diff, and audit entries for review/debugging.", { workspace: stringProp(), sessionId: stringProp(), auditLimit: numberProp(1, 1000) }, ["workspace", "sessionId"]),

  tool("relai_repo_profile", "Repository Profile", "Detect repository stack, manifests, package managers, configured commands, and test surface.", { workspace: stringProp(), sessionId: stringProp() }, ["workspace"]),
  tool("relai_repo_relevant_files", "Repository Relevant Files", "Rank likely relevant files from the cached index or safe file tree using search terms.", { workspace: stringProp(), sessionId: stringProp(), terms: arrayProp("string", 0, 30), limit: numberProp(1, 500), includeTests: boolProp() }, ["workspace"]),
  tool("relai_repo_test_suggestions", "Repository Test Suggestions", "Suggest test command keys/commands from detected manifests and configured commands.", { workspace: stringProp(), sessionId: stringProp() }, ["workspace"]),

  tool("relai_apply_patch", "Apply Unified Diff", "Validate and apply a unified diff with git apply. Use dryRun=true first for check-only mode.", {
    workspace: stringProp(), sessionId: stringProp(), diff: stringProp(), dryRun: boolProp(), approvalId: stringProp()
  }, ["workspace", "diff"]),
  tool("relai_apply_patch_and_run", "Apply Patch And Run Tests", "Apply a patch, then run selected allowlisted tests. This is the main Codex-like build/verify tool.", {
    workspace: stringProp(), diff: stringProp(), dryRun: boolProp(), testCommandKeys: arrayProp("string", 0, 20), stopOnFailure: boolProp(), sessionId: stringProp(), approvalId: stringProp()
  }, ["workspace", "diff"]),
  tool("relai_run_test", "Run Allowlisted Test Command", "Run a locally configured test command by key. Arbitrary shell commands from the model are not accepted here.", {
    workspace: stringProp(), testCommandKey: stringProp(), sessionId: stringProp()
  }, ["workspace", "testCommandKey"]),
  tool("relai_run_test_matrix", "Run Test Matrix", "Run several allowlisted test commands in order and return all outputs.", {
    workspace: stringProp(), testCommandKeys: arrayProp("string", 1, 30), stopOnFailure: boolProp(), sessionId: stringProp()
  }, ["workspace", "testCommandKeys"]),
  tool("relai_run_command", "Run Configured Dev Command", "Run an allowlisted dev command by key, or an arbitrary command only if explicitly enabled in config.", {
    workspace: stringProp(), commandKey: stringProp(), command: stringProp(), sessionId: stringProp(), approvalId: stringProp()
  }, ["workspace"]),
  tool("relai_patch_test_loop", "Patch Test Loop", "Run a Codex-like patch/test cycle over one or more diffs, stopping at first patch or test failure.", {
    workspace: stringProp(), sessionId: stringProp(), patches: arrayProp("string", 1, 10), testCommandKeys: arrayProp("string", 0, 30), stopOnFailure: boolProp(), approvalId: stringProp()
  }, ["patches"]),
  tool("relai_job_start_command", "Start Background Command Job", "Start an allowlisted test or dev command as a background job and return a job id for polling.", {
    workspace: stringProp(), sessionId: stringProp(), testCommandKey: stringProp(), commandKey: stringProp()
  }, ["workspace"]),
  tool("relai_job_status", "Read Background Job Status", "Read job metadata and stdout/stderr tails.", {
    jobId: stringProp(), tailBytes: numberProp(0, 200000)
  }, ["jobId"]),
  tool("relai_job_list", "List Background Jobs", "List recent background jobs.", {
    limit: numberProp(1, 500)
  }),
  tool("relai_job_cancel", "Cancel Background Job", "Send SIGTERM or SIGKILL to a live background job. Requires admin permission profile.", {
    jobId: stringProp(), force: boolProp()
  }, ["jobId"]),
  tool("relai_docker_run", "Run Command In Docker Sandbox", "Run an allowlisted test/dev command inside an allowlisted Docker image with the workspace mounted at /workspace.", {
    workspace: stringProp(), sessionId: stringProp(), image: stringProp(), testCommandKey: stringProp(), commandKey: stringProp(), network: stringProp(), approvalId: stringProp()
  }, ["workspace"]),
  tool("relai_lock_acquire", "Acquire Workspace Lock", "Acquire a cooperative lock for a workspace/resource to prevent parallel sessions from editing the same target.", {
    workspace: stringProp(), resource: stringProp(), sessionId: stringProp(), owner: stringProp(), note: stringProp(), steal: boolProp()
  }, ["workspace"]),
  tool("relai_lock_release", "Release Workspace Lock", "Release a cooperative workspace/resource lock.", {
    workspace: stringProp(), resource: stringProp(), lockId: stringProp()
  }, ["workspace"]),
  tool("relai_lock_list", "List Workspace Locks", "List current cooperative locks.", {}),

  tool("relai_git_status", "Git Status", "Return git branch, cleanliness, and short status.", { workspace: stringProp(), sessionId: stringProp() }, ["workspace"]),
  tool("relai_git_diff", "Git Diff", "Return current unstaged or staged git diff.", {
    workspace: stringProp(), sessionId: stringProp(), staged: boolProp(), path: stringProp()
  }, ["workspace"]),
  tool("relai_git_log", "Git Log", "Return recent commits, optionally for one file.", {
    workspace: stringProp(), sessionId: stringProp(), limit: numberProp(1, 100), path: stringProp()
  }, ["workspace"]),
  tool("relai_git_show", "Git Show", "Show one commit/ref with stat and patch.", {
    workspace: stringProp(), sessionId: stringProp(), rev: stringProp()
  }, ["workspace", "rev"]),
  tool("relai_create_branch", "Create Git Branch", "Create and switch to a feature branch. Refuses protected branch names.", {
    workspace: stringProp(), branchName: stringProp(), fromRef: stringProp(), sessionId: stringProp()
  }, ["workspace", "branchName"]),
  tool("relai_switch_branch", "Switch Git Branch", "Switch to a branch. Protected branch switching is blocked unless destructive tools are explicitly enabled.", {
    workspace: stringProp(), branchName: stringProp()
  }, ["workspace", "branchName"]),
  tool("relai_commit_all", "Commit Workspace Changes", "Stage all workspace changes and commit them. Refuses commits directly on protected branches.", {
    workspace: stringProp(), message: stringProp(), sessionId: stringProp(), approvalId: stringProp()
  }, ["workspace", "message"]),
  tool("relai_push_branch", "Push Feature Branch", "Push current or provided feature branch to an allowlisted remote. Refuses protected branches.", {
    workspace: stringProp(), remote: stringProp(), branchName: stringProp(), sessionId: stringProp(), approvalId: stringProp()
  }, ["workspace"]),
  tool("relai_create_pr", "Create Draft Pull Request Via GitHub CLI", "Create a pull request with gh pr create. Disabled unless allowGitHubCli is true in config.json.", {
    workspace: stringProp(), title: stringProp(), body: stringProp(), base: stringProp(), head: stringProp(), draft: boolProp(), labels: arrayProp("string", 0, 20), reviewers: arrayProp("string", 0, 20), sessionId: stringProp(), approvalId: stringProp()
  }, ["workspace", "title"]),
  tool("relai_pr_checks", "Pull Request Checks Via GitHub CLI", "Read PR checks through gh pr checks. Disabled unless allowGitHubCli is true.", {
    workspace: stringProp(), pr: stringProp(), sessionId: stringProp()
  }, ["workspace"]),
  tool("relai_pr_watch_checks", "Watch Pull Request Checks", "Poll gh pr checks several times and return the timeline. Use this to repair CI failures after pushing.", {
    workspace: stringProp(), pr: stringProp(), sessionId: stringProp(), attempts: numberProp(1, 20), intervalSeconds: numberProp(1, 120)
  }, ["workspace"]),
  tool("relai_git_reset_worktree", "Reset Task Worktree", "Hard reset and optionally clean a task worktree. Requires admin permission profile and a task session worktree unless destructive tools are enabled.", {
    workspace: stringProp(), sessionId: stringProp(), clean: boolProp(), approvalId: stringProp()
  }, ["workspace"])
];

async function callTool(name, args = {}) {
  const config = readConfig();
  const started = Date.now();
  try {
    enforcePermission(config, name);
    const value = await dispatchTool(config, name, args || {});
    logAudit(config, { tool: name, ok: true, workspace: args && args.workspace, sessionId: args && args.sessionId, ms: Date.now() - started });
    return ok(value);
  } catch (error) {
    logAudit(config, { tool: name, ok: false, workspace: args && args.workspace, sessionId: args && args.sessionId, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function dispatchTool(config, name, args) {
  switch (name) {
    case "relai_version":
      return versionInfo();
    case "relai_config":
      return publicConfigSummary(config);
    case "relai_audit_tail":
      return readAudit(config, { limit: args.limit });
    case "relai_dashboard_summary":
      return dashboardSummary(config, args);
    case "relai_dashboard_open":
      return taskRunner.dashboardOpen(config, args);
    case "relai_dashboard_data":
      return productUx.dashboardData(config, args);
    case "relai_live_log_tail":
      return productUx.liveLogTail(config, args);
    case "relai_health_monitor":
      return productUx.healthMonitor(config, args);
    case "relai_cleanup_preview":
      return productUx.cleanupPreview(config, args);
    case "relai_cleanup_run":
      return productUx.cleanupRun(config, args);
    case "relai_doctor_fix":
      return productUx.doctorFix(config, args);
    case "relai_setup_wizard":
      return productUx.setupWizard(args);
    case "relai_import_original_relai_config":
      return productUx.importOriginalRelAiConfig(args);
    case "relai_state_export":
      return productUx.stateExport(config, args);
    case "relai_state_import":
      return productUx.stateImport(config, args);

    case "relai_scheduler_start":
      return scheduler.startScheduler(config, args);
    case "relai_scheduler_status":
      return { ...scheduler.readScheduler(config, args), schedule: scheduler.computeSchedule(config, args) };
    case "relai_scheduler_pause":
      return scheduler.pauseScheduler(config, args);
    case "relai_scheduler_resume":
      return scheduler.resumeScheduler(config, args);
    case "relai_scheduler_stop":
      return scheduler.stopScheduler(config, args);

    case "relai_merge_plan":
      return withWorkspace(config, args, (workspace) => mergeCoordinator.mergePlan(config, workspace, args));
    case "relai_merge_execute":
      if (args.dryRun === false) approvals.requireApproval(config, "merge", args);
      return withWorkspace(config, args, (workspace) => mergeCoordinator.mergeExecute(config, workspace, args));
    case "relai_merge_abort":
      approvals.requireApproval(config, "reset", args);
      return withWorkspace(config, args, (workspace) => mergeCoordinator.mergeAbort(config, workspace, args));
    case "relai_merge_status":
      return withWorkspace(config, args, (workspace) => mergeCoordinator.mergeStatus(config, workspace, args));

    case "relai_memory_read":
      return withWorkspace(config, args, (workspace) => memory.readMemory(config, workspace));
    case "relai_memory_write":
      return withWorkspace(config, args, (workspace) => memory.writeMemory(config, workspace, args));
    case "relai_memory_search":
      return withWorkspace(config, args, (workspace) => memory.searchMemory(config, workspace, args));
    case "relai_memory_clear":
      return withWorkspace(config, args, (workspace) => memory.clearMemory(config, workspace, args));

    case "relai_review_score":
    case "relai_review_security":
    case "relai_review_test_gaps":
    case "relai_review_regression_risks":
      return withWorkspace(config, args, (workspace) => review.reviewCurrentDiff(config, workspace, args));

    case "relai_snapshot_create":
      return withWorkspace(config, args, (workspace) => snapshots.createSnapshot(config, workspace, args));
    case "relai_snapshot_list":
      return snapshots.listSnapshots(config, args);
    case "relai_snapshot_read":
      return snapshots.readSnapshot(config, args.snapshotId);
    case "relai_snapshot_restore":
      if (args.dryRun === false) approvals.requireApproval(config, "reset", args);
      return withWorkspace(config, args, (workspace) => snapshots.restoreSnapshot(config, workspace, args));
    case "relai_snapshot_delete":
      return snapshots.deleteSnapshot(config, args);

    case "relai_semantic_index_build":
      return withWorkspace(config, args, (workspace) => semantic.buildSemanticIndex(config, workspace, args));
    case "relai_semantic_search":
      return withWorkspace(config, args, (workspace) => semantic.semanticSearch(config, workspace, args));
    case "relai_context_recommend":
      return withWorkspace(config, args, (workspace) => semantic.contextRecommend(config, workspace, args));

    case "relai_pr_comments_read":
      return withWorkspace(config, args, (workspace) => prWorkflow.prCommentsRead(config, workspace, args));
    case "relai_pr_requested_changes_plan":
      return withWorkspace(config, args, (workspace) => prWorkflow.requestedChangesPlan(config, workspace, args));
    case "relai_pr_reply_to_review":
      approvals.requireApproval(config, "pr", args);
      return withWorkspace(config, args, (workspace) => prWorkflow.replyToReview(config, workspace, args));

    case "relai_doctor":
      return doctor.doctor(config, args);
    case "relai_policy_summary":
      return policy.policySummary(config);
    case "relai_policy_evaluate":
      return policy.evaluatePolicy(config, args);

    case "relai_task_run":
      return withWorkspace(config, args, (workspace) => taskRunner.taskRun(config, workspace, args));
    case "relai_task_status":
      return taskRunner.taskStatus(config, args);
    case "relai_task_stop":
      return taskRunner.taskStop(config, args);
    case "relai_task_resume":
      return taskRunner.taskResume(config, args);

    case "relai_task_split":
      return withWorkspace(config, args, (workspace) => multiagent.taskSplit(config, workspace, args));
    case "relai_subtask_create":
      return withWorkspace(config, args, (workspace) => multiagent.subtaskCreate(config, workspace, args));
    case "relai_subtask_list":
      return { subtasks: multiagent.listSubtasks(config, args) };
    case "relai_subtask_read":
      return multiagent.readSubtask(config, args.subtaskId);
    case "relai_subtask_run":
      return withWorkspace(config, args, (workspace) => multiagent.subtaskRun(config, workspace, args));
    case "relai_subtask_merge_back":
      approvals.requireApproval(config, "merge", args);
      return withWorkspace(config, args, (workspace) => multiagent.subtaskMergeBack(config, workspace, args));
    case "relai_conflict_check":
      return withWorkspace(config, args, (workspace) => multiagent.conflictCheck(config, workspace, args));
    case "relai_agent_review_diff":
      return withWorkspace(config, args, (workspace) => multiagent.agentReviewDiff(config, workspace, args));
    case "relai_pr_review_summary":
      return withWorkspace(config, args, (workspace) => multiagent.prReviewSummary(config, workspace, args));
    case "relai_agent_review_pr":
      return withWorkspace(config, args, (workspace) => multiagent.agentReviewPr(config, workspace, args));
    case "relai_task_graph":
      return multiagent.taskGraph(config, args);
    case "relai_multiagent_status":
      return multiagent.multiagentStatus(config, args);

    case "relai_approval_request":
      return approvals.createApproval(config, args);
    case "relai_approval_read":
      return approvals.readApproval(config, args.approvalId);
    case "relai_approval_list":
      return { approvals: approvals.listApprovals(config, { status: args.status, limit: args.limit }) };
    case "relai_approval_resolve":
      return approvals.resolveApproval(config, args);
    case "relai_approval_grant":
      return approvals.resolveApproval(config, { ...args, status: "approved" });
    case "relai_approval_deny":
      return approvals.resolveApproval(config, { ...args, status: "rejected" });
    case "relai_approval_status":
      return approvals.readApproval(config, args.approvalId);

    case "relai_plan_create":
      return plans.createPlan(config, args);
    case "relai_plan_list":
      return { plans: plans.listPlans(config, { sessionId: args.sessionId, limit: args.limit }) };
    case "relai_plan_read":
      return plans.readPlan(config, args.planId);
    case "relai_plan_update":
      return plans.updatePlan(config, args);
    case "relai_plan_step_update":
      return plans.updatePlanStep(config, args);
    case "relai_plan_step_append":
      return plans.appendPlanStep(config, args);

    case "relai_task_start":
      resolveWorkspace(config, args.workspace);
      return sessions.createSession(config, args);
    case "relai_task_list":
      return { sessions: sessions.listSessions(config, { limit: args.limit }) };
    case "relai_task_read":
      return sessions.readSession(config, args.sessionId);
    case "relai_task_step":
      return sessions.appendStep(config, args);
    case "relai_task_update":
      return sessions.updateSession(config, args);
    case "relai_task_worktree_create": {
      const session = sessions.readSession(config, args.sessionId);
      const base = resolveWorkspace(config, args.workspace || session.workspace);
      return createTaskWorktree(config, base, { ...args, workspace: base.alias });
    }
    case "relai_task_worktree_remove": {
      approvals.requireApproval(config, "worktree-remove", args);
      const session = sessions.readSession(config, args.sessionId);
      const base = resolveWorkspace(config, args.workspace || session.workspace);
      return removeTaskWorktree(config, base, args);
    }
    case "relai_worktree_list":
      return withWorkspace(config, args, (workspace) => listWorktrees(workspace, config));

    case "relai_workspace_tree":
      return workspaceTree(config, args);
    case "relai_workspace_profile":
      return workspaceProfile(config, args);
    case "relai_read_files":
      return readFiles(config, args);
    case "relai_write_file":
      approvals.requireApproval(config, "write", args);
      return withWorkspace(config, args, (workspace) => writeTextFileSafe(workspace.path, args.path, args.content, { maxBytes: config.maxWriteFileBytes, expectedSha256: args.expectedSha256 }));
    case "relai_search":
      return searchWorkspace(config, args);
    case "relai_context_pack":
      return contextPack(config, args);
    case "relai_index_build":
      return withWorkspace(config, args, (workspace) => indexer.buildIndex(config, workspace, args));
    case "relai_index_stats":
      return withWorkspace(config, args, (workspace) => indexer.indexStats(config, workspace, args));
    case "relai_index_search":
      return withWorkspace(config, args, (workspace) => indexer.searchIndex(config, workspace, args));

    case "relai_task_bootstrap":
      return withWorkspace(config, args, (workspace) => orchestrator.bootstrapTask(config, workspace, args));
    case "relai_issue_to_pr_bootstrap":
      return withWorkspace(config, args, (workspace) => orchestrator.issueToPrBootstrap(config, workspace, args));
    case "relai_ci_repair_snapshot":
      return recordMaybe(config, args, "ci", async (workspace) => orchestrator.ciRepairSnapshot(config, workspace, args));
    case "relai_ci_watch":
      return recordMaybe(config, args, "ci-watch", async (workspace) => taskRunner.ciWatch(config, workspace, args));
    case "relai_ci_repair_run":
      return recordMaybe(config, args, "ci-repair", async (workspace) => taskRunner.ciRepairRun(config, workspace, args));

    case "relai_session_diff":
      return withWorkspace(config, args, (workspace) => taskRunner.sessionDiff(config, workspace, args));
    case "relai_session_changed_files":
      return withWorkspace(config, args, (workspace) => taskRunner.sessionChangedFiles(config, workspace, args));
    case "relai_session_test_summary":
      return taskRunner.sessionTestSummary(config, args);
    case "relai_session_export":
      return withWorkspace(config, args, (workspace) => taskRunner.sessionExport(config, workspace, args));

    case "relai_repo_profile":
      return withWorkspace(config, args, (workspace) => taskRunner.repoProfile(config, workspace, args));
    case "relai_repo_relevant_files":
      return withWorkspace(config, args, (workspace) => taskRunner.repoRelevantFiles(config, workspace, args));
    case "relai_repo_test_suggestions":
      return withWorkspace(config, args, (workspace) => taskRunner.repoTestSuggestions(config, workspace, args));

    case "relai_apply_patch":
      approvals.requireApproval(config, "patch", args);
      return withWorkspace(config, args, (workspace) => applyPatch(workspace, config, args.diff, { dryRun: Boolean(args.dryRun) }));
    case "relai_apply_patch_and_run":
      approvals.requireApproval(config, "patch", args);
      return recordMaybe(config, args, "patch_and_test", async (workspace) => applyPatchAndRun(workspace, config, args));
    case "relai_run_test":
      return recordMaybe(config, args, "test", async () => runTest(config, args));
    case "relai_run_test_matrix":
      return recordMaybe(config, args, "test_matrix", async () => runTestMatrix(config, args));
    case "relai_run_command":
      approvals.requireApproval(config, "command", args);
      return recordMaybe(config, args, "command", async (workspace) => runConfiguredCommand(workspace, config, args));
    case "relai_patch_test_loop":
      approvals.requireApproval(config, "patch", args);
      return recordMaybe(config, args, "patch_test_loop", async (workspace) => patchTestLoop(workspace, config, args));
    case "relai_job_start_command":
      return withWorkspace(config, args, (workspace) => startCommandJob(config, workspace, args));
    case "relai_job_status":
      return jobStatus(config, args);
    case "relai_job_list":
      return { jobs: listJobs(config, { limit: args.limit }) };
    case "relai_job_cancel":
      return cancelJob(config, args);
    case "relai_docker_run":
      approvals.requireApproval(config, "docker", args);
      return recordMaybe(config, args, "docker", async (workspace) => runDocker(config, workspace, args));
    case "relai_lock_acquire":
      return locks.acquireLock(config, args);
    case "relai_lock_release":
      return locks.releaseLock(config, args);
    case "relai_lock_list":
      return locks.listLocks(config);

    case "relai_git_status":
      return withWorkspace(config, args, (workspace) => gitStatus(workspace, config));
    case "relai_git_diff":
      return withWorkspace(config, args, (workspace) => {
        const safePath = args.path ? resolveSafePath(workspace.path, args.path).relativePath : undefined;
        return gitDiff(workspace, config, { staged: Boolean(args.staged), path: safePath });
      });
    case "relai_git_log":
      return withWorkspace(config, args, (workspace) => {
        const safePath = args.path ? resolveSafePath(workspace.path, args.path).relativePath : undefined;
        return gitLog(workspace, config, { limit: args.limit, path: safePath });
      });
    case "relai_git_show":
      return withWorkspace(config, args, (workspace) => gitShow(workspace, config, args.rev));
    case "relai_create_branch":
      return recordMaybe(config, args, "branch", async (workspace) => createBranch(workspace, config, args.branchName, { fromRef: args.fromRef }));
    case "relai_switch_branch":
      return withWorkspace(config, args.workspace, (workspace) => switchBranch(workspace, config, args.branchName));
    case "relai_commit_all":
      approvals.requireApproval(config, "commit", args);
      return recordMaybe(config, args, "commit", async (workspace) => commitAll(workspace, config, args.message));
    case "relai_push_branch":
      approvals.requireApproval(config, "push", args);
      return recordMaybe(config, args, "push", async (workspace) => pushBranch(workspace, config, args.remote || "origin", args.branchName || null));
    case "relai_create_pr":
      approvals.requireApproval(config, "pr", args);
      return recordMaybe(config, args, "pr", async (workspace) => createPrWithGh(workspace, config, args));
    case "relai_pr_checks":
      return recordMaybe(config, args, "checks", async (workspace) => prChecksWithGh(workspace, config, args));
    case "relai_pr_watch_checks":
      return recordMaybe(config, args, "checks", async (workspace) => watchPrChecks(workspace, config, args));
    case "relai_git_reset_worktree":
      approvals.requireApproval(config, "reset", args);
      return recordMaybe(config, args, "reset", async (workspace) => resetWorktree(workspace, config, args));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function recordMaybe(config, args, type, fn) {
  const result = await withWorkspace(config, args, fn);
  if (args.sessionId) {
    sessions.appendStep(config, {
      sessionId: args.sessionId,
      type,
      title: titleFromType(type),
      details: JSON.stringify(result, null, 2),
      data: compactData(result)
    });
  }
  return result;
}

function titleFromType(type) {
  return ({ patch_and_test: "Applied patch and ran tests", test: "Ran test", test_matrix: "Ran test matrix", command: "Ran command", branch: "Created branch", commit: "Committed changes", push: "Pushed branch", pr: "Created PR", checks: "Read PR checks", docker: "Ran Docker command", patch_test_loop: "Ran patch/test loop", reset: "Reset worktree" })[type] || type;
}

function compactData(result) {
  if (!result || typeof result !== "object") return undefined;
  return { ok: Boolean(result.ok), message: result.message, branch: result.branch, touchedPaths: result.touchedPaths };
}

async function withWorkspace(config, requestOrAlias, fn) {
  const request = requestOrAlias && typeof requestOrAlias === "object" ? requestOrAlias : { workspace: requestOrAlias };
  let alias = request.workspace;
  if (!alias && request.sessionId) {
    alias = sessions.readSession(config, request.sessionId).workspace;
  }
  const base = resolveWorkspace(config, alias);
  const workspace = request.sessionId ? workspaceFromSession(config, base, request.sessionId) : base;
  return fn(workspace);
}

function versionInfo() {
  return {
    name: pkg.name,
    version: pkg.version,
    node: process.version,
    pid: process.pid,
    transports: ["stdio", "streamable-http", "sse"],
    toolCount: toolSchemas.length,
    capabilities: [
      "workspace tree/search/read/write",
      "task sessions",
      "audit log",
      "patch check/apply",
      "test matrix",
      "configured command runner",
      "git branch/diff/log/commit/push",
      "GitHub CLI PR creation/checks",
      "worktree-per-task isolation",
      "background job queue",
      "Docker sandbox hooks",
      "CI check watcher",
      "permission profiles",
      "task worktree reset/remove",
      "persistent implementation plans",
      "approval gates",
      "repository indexing",
      "issue-to-PR bootstrap",
      "CI repair snapshots",
      "cooperative workspace locks",
      "dashboard summary",
      "high-level task runner",
      "task execution modes",
      "CI watch and repair loop",
      "session diff/export tools",
      "repository relevance and test suggestion tools",
      "approval grant/deny aliases",
      "multi-agent task splitting",
      "agent subtask sessions and worktrees",
      "subtask dependency graph",
      "changed-file conflict detection",
      "review-agent diff and PR summaries",
      "subtask merge-back preflight",
      "dependency-aware multi-agent scheduler",
      "merge coordinator",
      "local repository memory",
      "review risk scoring",
      "workspace snapshots and rollback",
      "semantic-ish local search",
      "PR requested-changes workflow",
      "doctor checks",
      "policy evaluation",
      "rich dashboard data and live audit logs",
      "health monitoring and stale-state detection",
      "cleanup preview/run workflows",
      "doctor --fix style line-ending normalization",
      "setup wizard and original Rel.AI config import",
      "state export/import for backups"
    ]
  };
}

function dashboardSummary(config, args = {}) {
  const limit = args.limit || 50;
  return {
    ok: true,
    version: versionInfo(),
    config: publicConfigSummary(config),
    sessions: sessions.listSessions(config, { limit }),
    jobs: listJobs(config, { limit }),
    approvals: approvals.listApprovals(config, { limit }),
    locks: locks.listLocks(config).locks,
    multiAgent: multiagent.multiagentStatus(config, { limit })
  };
}

function workspaceTree(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
  const result = collectTextFiles(workspace.path, {
    maxEntries: args.maxEntries || config.maxTreeEntries,
    maxFileBytes: config.maxSearchFileBytes
  });
  return {
    workspace: workspace.alias,
    root: workspace.path,
    fileCount: result.files.length,
    files: result.files,
    skipped: result.skipped.slice(0, 300),
    truncated: result.truncated
  };
}

function workspaceProfile(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
  const manifests = [
    "package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb",
    "pyproject.toml", "requirements.txt", "poetry.lock", "Pipfile",
    "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "gradlew", "composer.json", "Gemfile", ".csproj", "pubspec.yaml"
  ];
  const present = [];
  for (const manifest of manifests) {
    try {
      const safe = resolveSafePath(workspace.path, manifest);
      if (fs.existsSync(safe.absolutePath)) present.push(manifest);
    } catch (_error) {}
  }
  const hints = [];
  if (present.includes("package.json")) hints.push("Node/JavaScript/TypeScript project");
  if (present.includes("pnpm-lock.yaml")) hints.push("Likely package manager: pnpm");
  else if (present.includes("yarn.lock")) hints.push("Likely package manager: yarn");
  else if (present.includes("package-lock.json")) hints.push("Likely package manager: npm");
  if (present.includes("pyproject.toml") || present.includes("requirements.txt")) hints.push("Python project");
  if (present.includes("Cargo.toml")) hints.push("Rust project");
  if (present.includes("go.mod")) hints.push("Go project");
  return {
    workspace: workspace.alias,
    root: workspace.path,
    manifests: present,
    hints,
    configuredTestCommands: Object.keys(workspace.testCommands || {}).sort(),
    configuredCommands: Object.keys(workspace.commands || {}).sort()
  };
}

function readFiles(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) throw new Error("paths must contain at least one file.");
  const files = [];
  const skipped = [];
  for (const requestedPath of paths) {
    try {
      const safePath = resolveSafePath(workspace.path, requestedPath).relativePath;
      files.push({
        path: safePath,
        ...(args.includeSha256 ? { sha256: fileSha256(workspace.path, safePath) } : {}),
        content: readTextFileSafe(workspace.path, safePath, config.maxReadFileBytes)
      });
    } catch (error) {
      skipped.push({ path: String(requestedPath), reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { workspace: workspace.alias, files, skipped };
}

function searchWorkspace(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
  const query = String(args.query || "");
  if (!query.trim()) throw new Error("query is required.");
  const maxMatches = Math.min(Math.max(Number(args.maxMatches || 50), 1), 500);
  const tree = collectTextFiles(workspace.path, {
    maxEntries: config.maxTreeEntries,
    maxFileBytes: config.maxSearchFileBytes
  });
  const matches = [];
  for (const relativePath of tree.files) {
    if (matches.length >= maxMatches) break;
    let content;
    try { content = readTextFileSafe(workspace.path, relativePath, config.maxSearchFileBytes); } catch (_error) { continue; }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length && matches.length < maxMatches; i += 1) {
      if (lines[i].includes(query)) matches.push({ path: relativePath, line: i + 1, text: lines[i].slice(0, 500) });
    }
  }
  return { workspace: workspace.alias, query, matches, searchedFiles: tree.files.length, skipped: tree.skipped.slice(0, 50) };
}

function contextPack(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
  const explicit = readFiles(config, { workspace: workspace.alias, paths: Array.isArray(args.paths) ? args.paths : [], includeSha256: true });
  const searches = [];
  for (const term of Array.isArray(args.searchTerms) ? args.searchTerms : []) {
    if (!String(term).trim()) continue;
    searches.push(searchWorkspace(config, { workspace: workspace.alias, query: String(term), maxMatches: args.maxSearchMatches || 50 }));
  }
  const tree = args.includeTree === false ? null : workspaceTree(config, { workspace: workspace.alias, maxEntries: Math.min(config.maxTreeEntries, 2000) });
  return { workspace: workspace.alias, tree, explicitFiles: explicit, searches };
}

async function runTest(config, args) {
  const workspace = resolveTargetWorkspace(config, args);
  const key = String(args.testCommandKey || "").trim();
  if (!key) throw new Error("testCommandKey is required.");
  const command = workspace.testCommands && workspace.testCommands[key];
  if (!command) throw new Error(`Test command key '${key}' is not configured for workspace '${workspace.alias}'.`);
  const result = await runProcess(command, [], { cwd: workspace.path, shell: true, commandString: command }, config);
  return { workspace: workspace.alias, testCommandKey: key, command, ...summarizeCommand(result) };
}

async function runTestMatrix(config, args) {
  const keys = Array.isArray(args.testCommandKeys) ? args.testCommandKeys : [];
  if (keys.length === 0) throw new Error("testCommandKeys must contain at least one key.");
  const results = [];
  for (const key of keys) {
    const result = await runTest(config, { workspace: args.workspace, testCommandKey: key });
    results.push(result);
    if (!result.ok && args.stopOnFailure !== false) break;
  }
  return { ok: results.every((item) => item.ok), workspace: args.workspace, results };
}

function resolveTargetWorkspace(config, args = {}) {
  let alias = args.workspace;
  if (!alias && args.sessionId) alias = sessions.readSession(config, args.sessionId).workspace;
  const base = resolveWorkspace(config, alias);
  return args.sessionId ? workspaceFromSession(config, base, args.sessionId) : base;
}

async function patchTestLoop(workspace, config, args = {}) {
  const patches = Array.isArray(args.patches) ? args.patches : [];
  if (patches.length === 0) throw new Error("patches must contain at least one diff.");
  const cycles = [];
  for (let i = 0; i < patches.length; i += 1) {
    const result = await applyPatchAndRun(workspace, config, {
      diff: patches[i],
      testCommandKeys: Array.isArray(args.testCommandKeys) ? args.testCommandKeys : [],
      stopOnFailure: args.stopOnFailure !== false
    });
    cycles.push({ index: i, ...result });
    if (!result.ok && args.stopOnFailure !== false) break;
  }
  return { ok: cycles.every((cycle) => cycle.ok), workspace: workspace.alias, cycles };
}

async function watchPrChecks(workspace, config, args = {}) {
  const attempts = Math.min(Math.max(Number(args.attempts || 3), 1), 20);
  const intervalMs = Math.min(Math.max(Number(args.intervalSeconds || 5), 1), 120) * 1000;
  const timeline = [];
  for (let i = 0; i < attempts; i += 1) {
    const result = await prChecksWithGh(workspace, config, args);
    timeline.push({ attempt: i + 1, ts: new Date().toISOString(), ...result });
    const text = `${result.result && result.result.stdout || ""}
${result.result && result.result.stderr || ""}`;
    if (result.ok && !/pending|queued|in_progress|waiting/i.test(text)) break;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ok: timeline.length > 0 && timeline[timeline.length - 1].ok, attempts: timeline.length, timeline };
}

async function resetWorktree(workspace, config, args = {}) {
  if (!workspace.taskSessionId && !workspace.allowDestructiveTools) {
    throw new Error("Hard reset is only allowed for attached task worktrees unless allowDestructiveTools is enabled.");
  }
  const reset = await runGit(["reset", "--hard"], workspace, config);
  const clean = args.clean ? await runGit(["clean", "-fd"], workspace, config) : null;
  return { ok: reset.exitCode === 0 && (!clean || clean.exitCode === 0), reset: summarizeCommand(reset), ...(clean ? { clean: summarizeCommand(clean) } : {}) };
}

function ok(value) {
  return value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "ok")
    ? value
    : { ok: true, ...value };
}

function tool(name, title, description, properties, required = []) {
  return { name, title, description, inputSchema: { type: "object", properties, required, additionalProperties: false } };
}
function stringProp() { return { type: "string" }; }
function boolProp() { return { type: "boolean" }; }
function numberProp(min, max) { return { type: "number", minimum: min, maximum: max }; }
function objectProp() { return { type: "object" }; }
function arrayProp(type, minItems, maxItems) { return { type: "array", items: { type }, minItems, maxItems }; }

module.exports = { toolSchemas, callTool };
