const { runProcess, summarizeCommand } = require("./process");
const sessions = require("./sessions");
const plans = require("./plans");
const { createTaskWorktree } = require("./worktrees");
const { buildIndex } = require("./indexer");
const { prChecksWithGh } = require("./git");

async function bootstrapTask(config, workspace, args = {}) {
  const goal = String(args.goal || "").trim();
  if (!goal) throw new Error("goal is required.");
  const session = sessions.createSession(config, {
    workspace: workspace.baseAlias || workspace.alias,
    goal,
    branch: args.branchName || args.branch || null
  });
  let worktree = null;
  if (args.createWorktree !== false) {
    worktree = await createTaskWorktree(config, workspace, {
      sessionId: session.id,
      branchName: args.branchName || session.branch || `relai/${session.id}`,
      fromRef: args.fromRef || workspace.defaultBaseBranch || "main"
    });
  }
  const taskWorkspace = worktree && worktree.ok ? { ...workspace, path: worktree.worktreePath, alias: `${workspace.alias}:${session.id}`, taskSessionId: session.id } : workspace;
  const fastTask = taskWorkspace.fastTask && taskWorkspace.fastTask.enabled !== false ? taskWorkspace.fastTask : null;
  const shouldBuildIndex = args.buildIndex !== false && !(args.buildIndex == null && fastTask && fastTask.skipIndexForSmallTasks !== false);
  const index = shouldBuildIndex ? buildIndex(config, taskWorkspace, { sessionId: session.id, maxFiles: args.maxIndexFiles || (fastTask && fastTask.maxIndexFiles) }) : null;
  const plan = plans.createPlan(config, {
    sessionId: session.id,
    workspace: workspace.baseAlias || workspace.alias,
    title: args.title || "Rel.AI MCP implementation plan",
    goal,
    steps: Array.isArray(args.steps) && args.steps.length ? args.steps : defaultPlanSteps(args),
    risks: ["Generated plan should be reviewed before commit/push/PR.", "Tests may need project-specific allowlisted command keys."],
    validation: Array.isArray(args.testCommandKeys) ? args.testCommandKeys.map((key) => `Run configured test command: ${key}`) : []
  });
  return { ok: true, session, worktree, index: index ? { fileCount: index.fileCount, skippedCount: index.skippedCount, builtAt: index.builtAt } : null, plan };
}

function defaultPlanSteps(args = {}) {
  return [
    { title: "Inspect focused context", details: "Read relevant files, manifests, and existing tests before editing.", toolHint: "relai_context_pack" },
    { title: "Implement minimal change", details: "Patch or write files in the task worktree only.", toolHint: "relai_apply_patch" },
    { title: "Run validation", details: `Run ${Array.isArray(args.testCommandKeys) && args.testCommandKeys.length ? args.testCommandKeys.join(", ") : "configured tests or type checks"}.`, toolHint: "relai_run_test_matrix" },
    { title: "Review diff", details: "Read git diff and summarize risks before commit.", toolHint: "relai_git_diff" },
    { title: "Prepare PR", details: "Commit, push, and create draft PR only after approval gates pass.", toolHint: "relai_create_pr" }
  ];
}

async function issueToPrBootstrap(config, workspace, args = {}) {
  if (!config.allowGitHubCli) throw new Error("GitHub CLI is disabled. Set allowGitHubCli: true to use issue-to-PR bootstrap.");
  const issue = String(args.issue || args.issueNumber || "").trim();
  if (!issue) throw new Error("issue or issueNumber is required.");
  const view = await runProcess("gh", ["issue", "view", issue, "--json", "number,title,body,url,labels"], { cwd: workspace.path, shell: false }, config);
  if (view.exitCode !== 0) return { ok: false, issue, view: summarizeCommand(view) };
  let parsed;
  try { parsed = JSON.parse(view.stdout || "{}"); } catch (_error) { parsed = { title: `Issue ${issue}`, body: view.stdout || "" }; }
  const title = parsed.title || `Issue ${issue}`;
  const branchName = args.branchName || `relai/issue-${parsed.number || issue}`;
  const goal = `Resolve GitHub issue #${parsed.number || issue}: ${title}\n\n${parsed.body || ""}`.trim();
  const boot = await bootstrapTask(config, workspace, {
    goal,
    title: `Issue #${parsed.number || issue}: ${title}`,
    branchName,
    fromRef: args.fromRef,
    createWorktree: args.createWorktree !== false,
    buildIndex: args.buildIndex !== false,
    testCommandKeys: args.testCommandKeys
  });
  sessions.appendStep(config, { sessionId: boot.session.id, type: "github-issue", title: "Loaded GitHub issue", details: JSON.stringify(parsed, null, 2), data: { ok: true, issue: parsed.number || issue, url: parsed.url } });
  return { ok: true, issue: parsed, ...boot };
}

async function ciRepairSnapshot(config, workspace, args = {}) {
  const checks = await prChecksWithGh(workspace, config, args);
  const stdout = (checks.result && checks.result.stdout) || "";
  const stderr = (checks.result && checks.result.stderr) || "";
  const text = `${stdout}\n${stderr}`;
  const failing = /fail|error|cancel/i.test(text);
  const pending = /pending|queued|in_progress|waiting/i.test(text);
  const repairRequest = failing ? [
    "CI appears to have failing checks.",
    "Use relai_pr_checks output to identify failing jobs.",
    "Fetch detailed logs with project-specific GitHub tooling if needed.",
    "Patch the task worktree, run local tests, commit, push, and watch checks again."
  ].join("\n") : (pending ? "Checks are still pending. Poll again later." : "No obvious failing check text detected.");
  if (args.sessionId) {
    sessions.appendStep(config, { sessionId: args.sessionId, type: "ci", title: "Captured PR check snapshot", details: JSON.stringify({ checks, repairRequest }, null, 2), data: { ok: checks.ok, failing, pending } });
  }
  return { ok: checks.ok, failing, pending, checks, repairRequest };
}

module.exports = { bootstrapTask, issueToPrBootstrap, ciRepairSnapshot };
