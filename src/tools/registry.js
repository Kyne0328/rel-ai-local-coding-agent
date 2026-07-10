'use strict';

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "relai_repo_snapshot",
    title: "Repository Overview",
    description: "Read-only. Compact repository overview: file tree, manifests, detected checks, and project hints.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"maxEntries":{"type":"number","minimum":1,"maximum":20000},"includeFiles":{"type":"boolean"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "repoSnapshot",
    public: true,
    publicOrder: 0,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"snapshot","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_read",
    title: "Read Local Repo Paths",
    description: "Read-only. Batch-read files or directory summaries from the workspace.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"paths":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":100},"maxBytes":{"type":"number","minimum":1000,"maximum":10485760},"maxEntries":{"type":"number","minimum":1,"maximum":20000}},"required":["workspace","paths"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "read",
    public: true,
    publicOrder: 1,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"read","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_write",
    title: "Write Local Repo File",
    description: "Full-file replacement. Prefer direct { workspace, path, content } for complete-file updates — direct write has no size cap. Staged mode (stage:'start'/'append'/'commit') exists only for transports that cap a single message; if used and writeId is omitted, append/commit resolve the single in-flight staged write (or pass path to disambiguate when several are pending).",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"path":{"type":"string"},"content":{"type":"string"},"dryRun":{"type":"boolean"},"stage":{"type":"string"},"writeId":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "write",
    public: true,
    publicOrder: 5,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"path","cache":"paths","startsSession":true,"deferStagedSession":true,"sessionWrite":true,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_replace",
    title: "Replace Exact Text",
    description: "Small deterministic edits inside an existing file. Provide { workspace, path, oldText, newText } or replacements: [{ oldText, newText, occurrence? }]. Duplicate matches require occurrence.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"},"expectedSha256":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000},"replacements":{"type":"array","items":{"type":"object","properties":{"oldText":{"type":"string"},"newText":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000}},"required":["oldText","newText"],"additionalProperties":false},"minItems":1,"maxItems":50},"dryRun":{"type":"boolean"}},"required":["workspace","path"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "replace",
    public: true,
    publicOrder: 6,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"path","cache":"paths","startsSession":true,"deferStagedSession":false,"sessionWrite":true,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_tidy_plan",
    title: "Workspace Tidy Plan",
    description: "Read-only. Prepare a bounded workspace tidy plan for session-owned untracked artifacts. The server selects candidates; callers do not provide file paths.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"mode":{"type":"string"},"maxCandidates":{"type":"number","minimum":1,"maximum":100}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "tidyPlan",
    public: true,
    publicOrder: 7,
    publicStrip: [],
    groups: ["cleanup"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_tidy_run",
    title: "Run Workspace Tidy Plan",
    description: "Apply a previously prepared workspace tidy plan by planId. The plan is expiry-bound and hash-checked before any workspace change.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"planId":{"type":"string"}},"required":["workspace","planId"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "tidyRun",
    public: true,
    publicOrder: 8,
    publicStrip: [],
    groups: ["cleanup"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_clear_files",
    title: "Discard Workspace Files",
    description: "Discard one or more generated or temporary files from a configured workspace. Folders are refused. Supports dryRun and failIfMissing.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"path":{"type":"string"},"paths":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":100},"expectedSha256":{"type":"string"},"dryRun":{"type":"boolean"},"failIfMissing":{"type":"boolean"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "clearFiles",
    public: false,
    publicOrder: -1,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"clearPaths","cache":"clearPaths","startsSession":true,"deferStagedSession":false,"sessionWrite":true,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_apply_update",
    title: "Apply Prepared Update",
    description: "Apply a prepared text update to the workspace and optionally validate afterward. Accepts either git unified diff (--- a/path / +++ b/path / @@ hunks) or OpenAI patch format (*** Begin Patch / *** Update File: path / *** End Patch). The workspace must be clean by default; pass requireCleanGit:false to apply when the worktree already has unrelated changes (a backup is still taken).",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"updateText":{"type":"string"},"backup":{"type":"boolean"},"requireCleanGit":{"type":"boolean"},"dryRun":{"type":"boolean"},"check":{"type":"string"},"checks":{"type":"array","items":{"type":"string"},"minItems":0},"checksText":{"type":"string"},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000},"stopOnFailure":{"type":"boolean"},"returnDiff":{"type":"boolean"},"maxResultBytes":{"type":"number","minimum":1000,"maximum":5242880}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "applyUpdate",
    public: false,
    publicOrder: -1,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"workspace","startsSession":true,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_apply_bundle",
    title: "Apply Prepared Bundle",
    description: "Apply a prepared file bundle to the workspace and optionally validate afterward. The workspace must be clean by default; pass requireCleanGit:false to apply when the worktree already has unrelated changes (a backup is still taken).",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"bundlePath":{"type":"string"},"path":{"type":"string"},"stripRoot":{"type":"boolean"},"clearMissing":{"type":"boolean"},"backup":{"type":"boolean"},"requireCleanGit":{"type":"boolean"},"dryRun":{"type":"boolean"},"check":{"type":"string"},"checks":{"type":"array","items":{"type":"string"},"minItems":0},"checksText":{"type":"string"},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000},"stopOnFailure":{"type":"boolean"},"returnDiff":{"type":"boolean"},"maxResultBytes":{"type":"number","minimum":1000,"maximum":5242880}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "applyBundle",
    public: true,
    publicOrder: 9,
    publicStrip: ["check","checks","checksText"],
    groups: [],
    behavior: {"audit":"","cache":"workspace","startsSession":true,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_package_snapshot",
    title: "Package Workspace Zip",
    description: "Create a zip package of the current workspace, excluding repo internals, dependency caches, build outputs, and Rel.AI state.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"maxFiles":{"type":"number","minimum":1,"maximum":200000},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "packageSnapshot",
    public: true,
    publicOrder: 10,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_run_checks",
    title: "Workspace Checks",
    description: "Run workspace validation checks (tests, linters, analyzers, build). Use level quick, standard, or release. Output is bounded to each step's tail where failures appear; pass fullOutput:true for a larger tail.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"level":{"type":"string"},"check":{"type":"string"},"checks":{"type":"array","items":{"type":"string"},"minItems":0},"checksText":{"type":"string"},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000},"stopOnFailure":{"type":"boolean"},"fullOutput":{"type":"boolean"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "runChecks",
    public: true,
    publicOrder: 11,
    publicStrip: ["check","checks","checksText"],
    groups: [],
    behavior: {"audit":"checks","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":"checks"},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_browser",
    title: "UI Route Check",
    description: "Load a configured workspace route (route) and return its HTTP status, byte count, title, and errors. Pass check to run a named package.json script; only declared scripts are accepted.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"url":{"type":"string"},"route":{"type":"string"},"check":{"type":"string"},"timeoutMs":{"type":"number","minimum":1000,"maximum":1800000}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "browser",
    public: true,
    publicOrder: 12,
    publicStrip: ["url"],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_diff",
    title: "Review Local Repo Diff",
    description: "Read-only. Return repository status and current diff as a review artifact. Pass path to filter to a single file. When a trusted session is active, sessionChangedFiles and baselineChangedFiles split the status entries by ownership (this session vs. pre-existing dirty worktree).",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"staged":{"type":"boolean"},"path":{"type":"string"},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "diff",
    public: true,
    publicOrder: 3,
    publicStrip: [],
    groups: ["audit"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":"diff"},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_restore_changes",
    title: "Revert To Saved State",
    description: "Revert selected workspace changes, or return the workspace to the last saved state.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"paths":{"type":"array","items":{"type":"string"},"minItems":0,"maxItems":100},"mode":{"type":"string"},"clean":{"type":"boolean"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "restore",
    public: true,
    publicOrder: 13,
    publicStrip: [],
    groups: ["cleanup"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_status",
    title: "Rel.AI Status",
    description: "Read-only. Compact live status for configured workspaces, scripts, and CI references. Prefer this over reading source files when checking whether an update is active. Includes active session policy and trusted-agent state.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"}},"required":[],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "status",
    public: true,
    publicOrder: 2,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_feature_probe",
    title: "Rel.AI Feature Probe",
    description: "Read-only. Compact booleans for important runtime behavior. Prefer this over source reads when checking installed behavior. Includes sessionPolicySupport flag.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"}},"required":[],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "featureProbe",
    public: false,
    publicOrder: -1,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_status",
    title: "Repository State",
    description: "Read-only repository state: current branch, ahead/behind counts, ownership split, and untracked-file summary. Reports metadata only and changes nothing.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitStatus",
    public: true,
    publicOrder: 14,
    publicStrip: [],
    groups: ["git","audit"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_fetch",
    title: "Update Remote Refs",
    description: "Update local copies of remote branch refs, optionally pruning stale refs, before merge planning. Does not modify working files.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"remote":{"type":"string"},"prune":{"type":"boolean"},"stopOnFailure":{"type":"boolean"},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitFetch",
    public: false,
    publicOrder: -1,
    publicStrip: [],
    groups: ["git"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_commit",
    title: "Record Commit",
    description: "Record a commit with an explicit message, with optional dry-run planning and path scoping.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"message":{"type":"string"},"dryRun":{"type":"boolean"},"addAll":{"type":"boolean"},"paths":{"type":"array","items":{"type":"string"},"minItems":0,"maxItems":200},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000}},"required":["workspace","message"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitCommit",
    public: true,
    publicOrder: 15,
    publicStrip: [],
    groups: ["git"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_push",
    title: "Publish Branch",
    description: "Publish a branch to a remote, with optional dry-run and set-upstream behavior.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"remote":{"type":"string"},"branch":{"type":"string"},"dryRun":{"type":"boolean"},"setUpstream":{"type":"boolean"},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitPush",
    public: true,
    publicOrder: 16,
    publicStrip: [],
    groups: ["git"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_merge_branch",
    title: "Combine Branches",
    description: "Merge a source branch into a target branch with protected-branch checks and dry-run abort support.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"source":{"type":"string"},"branch":{"type":"string"},"target":{"type":"string"},"dryRun":{"type":"boolean"},"ffOnly":{"type":"boolean"},"allowProtected":{"type":"boolean"},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000}},"required":["workspace","source"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitMergeBranch",
    public: false,
    publicOrder: -1,
    publicStrip: [],
    groups: ["git"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_merge_remote_branches_plan",
    title: "Branch Merge Plan",
    description: "Read-only. List remote branches, exclude protected branches, and recommend a merge order before touching production branches.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"remote":{"type":"string"},"targetBranch":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitMergeRemoteBranchesPlan",
    public: false,
    publicOrder: -1,
    publicStrip: [],
    groups: ["git"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_abort_merge",
    title: "Cancel In-Progress Merge",
    description: "Cancel an in-progress merge safely.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitAbortMerge",
    public: false,
    publicOrder: -1,
    publicStrip: [],
    groups: ["git"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_create_pr",
    title: "Draft Pull Request",
    description: "Read-only. Draft a pull-request title/body from a base/head diff without touching the remote host.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"base":{"type":"string"},"head":{"type":"string"},"title":{"type":"string"},"body":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitCreatePr",
    public: true,
    publicOrder: 17,
    publicStrip: [],
    groups: ["git"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_remove_file",
    title: "Retire Obsolete File",
    description: "Retire a single obsolete file with an explicit reason and optional staging.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"path":{"type":"string"},"reason":{"type":"string"},"expectedSha256":{"type":"string"},"dryRun":{"type":"boolean"},"failIfMissing":{"type":"boolean"},"stage":{"type":"boolean"}},"required":["workspace","path"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "removeFile",
    public: false,
    publicOrder: -1,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":true,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_refactor_audit",
    title: "Refactor Audit",
    description: "Read-only. Scan source, tests, UI text, docs, and data-shaped files for stale old terms and expected new terms after a refactor.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"oldTerms":{"type":"array","items":{"type":"string"},"minItems":0,"maxItems":100},"newTerms":{"type":"array","items":{"type":"string"},"minItems":0,"maxItems":100},"oldTerm":{"type":"string"},"newTerm":{"type":"string"},"find":{"type":"string"},"expect":{"type":"string"},"includeGenerated":{"type":"boolean"},"maxEntries":{"type":"number","minimum":1,"maximum":20000}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "refactorAudit",
    public: false,
    publicOrder: -1,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_edit",
    title: "Unified Workspace Edit",
    description: "The one tool for changing files. The server auto-picks the mechanism: oldText+newText for an exact edit, content for a full-file write (large files chunk automatically), updateText for a unified/OpenAI diff, or edits:[...] to apply several edits in one call. Pass runChecks:true to validate (optional level quick/standard/release, default standard) and returnDiff:true to review, all in one approval.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"},"content":{"type":"string"},"updateText":{"type":"string"},"edits":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"},"content":{"type":"string"}},"required":["path"],"additionalProperties":false},"minItems":1,"maxItems":20},"runChecks":{"type":"boolean"},"level":{"type":"string"},"returnDiff":{"type":"boolean"},"dryRun":{"type":"boolean"},"stage":{"type":"string"},"writeId":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "edit",
    public: true,
    publicOrder: 4,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"edit","cache":"edit","startsSession":true,"deferStagedSession":true,"sessionWrite":true,"summary":"edit"},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_set_policy",
    title: "Set Workspace Session Policy",
    description: "Set or clear the trusted session policy for a workspace. Call with taskHint to record what the current task is. Call with clear: true to end the session. The effective policy is always trusted — this tool records session context, not access grants.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"taskHint":{"type":"string"},"clear":{"type":"boolean"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "setPolicy",
    public: false,
    publicOrder: -1,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"policy","cache":"policy","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_session_summary",
    title: "Workspace Session Summary",
    description: "Get a summary of what happened in the current workspace session — files changed, checks run, diff reviewed, and execution planner decisions. If a trusted session is active, returns events since session start. Otherwise returns recent audit activity up to the given limit.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"limit":{"type":"number","minimum":1,"maximum":200}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "sessionSummary",
    public: false,
    publicOrder: -1,
    publicStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  }
].map((definition) => Object.freeze(definition)));
const TOOL_DEFINITION_BY_NAME = new Map(TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

function getToolDefinition(name) {
  return TOOL_DEFINITION_BY_NAME.get(String(name || '')) || null;
}

function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}

function getPublicToolDefinitions() {
  return TOOL_DEFINITIONS
    .filter((definition) => definition.public === true)
    .slice()
    .sort((left, right) => left.publicOrder - right.publicOrder);
}

function getToolGroups() {
  const publicDefinitions = getPublicToolDefinitions();
  const groups = {
    workspace: publicDefinitions.map((definition) => definition.name),
    git: [],
    audit: [],
    cleanup: [],
    internal: TOOL_DEFINITIONS.filter((definition) => definition.public !== true).map((definition) => definition.name)
  };
  for (const definition of publicDefinitions) {
    for (const group of definition.groups || []) {
      if (!groups[group]) groups[group] = [];
      groups[group].push(definition.name);
    }
  }
  return groups;
}

module.exports = {
  TOOL_DEFINITIONS,
  getToolDefinition,
  getToolDefinitions,
  getPublicToolDefinitions,
  getToolGroups
};
