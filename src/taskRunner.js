const fs = require("node:fs");
const path = require("node:path");
const sessions = require("./sessions");
const plans = require("./plans");
const indexer = require("./indexer");
const { readAudit } = require("./audit");
const { collectTextFiles, collectOptionsFromWorkspace, readTextFileSafe, resolveSafePath } = require("./safety");
const { runProcess, summarizeCommand } = require("./process");
const {
  gitStatus,
  gitDiff,
  applyPatchAndRun,
  commitAll,
  pushBranch,
  createPrWithGh,
  prChecksWithGh,
  runConfiguredCommand
} = require("./git");
const { createTaskWorktree, workspaceFromSession } = require("./worktrees");

const TASK_MODES = new Set([
  "plan_only",
  "implement_no_commit",
  "implement_and_test",
  "prepare_pr",
  "ci_repair",
  "review_only"
]);

async function taskRun(config, baseWorkspace, args = {}) {
  const mode = normalizeMode(args.mode || "implement_and_test");
  const goal = String(args.goal || args.task || "").trim();
  if (!goal && !args.sessionId) throw new Error("goal is required when sessionId is not provided.");

  let session;
  let workspace = baseWorkspace;
  const timeline = [];

  if (args.sessionId) {
    session = sessions.readSession(config, args.sessionId);
    workspace = workspaceFromSession(config, baseWorkspace, session.id);
  } else {
    session = sessions.createSession(config, {
      workspace: baseWorkspace.baseAlias || baseWorkspace.alias,
      goal,
      branch: args.branchName || null
    });
    timeline.push({ step: "session", ok: true, sessionId: session.id });
  }

  if (args.createWorktree !== false && !session.worktreePath && mode !== "review_only") {
    const worktree = await createTaskWorktree(config, baseWorkspace, {
      sessionId: session.id,
      branchName: args.branchName || session.branch || `relai/${session.id}`,
      fromRef: args.fromRef || baseWorkspace.defaultBaseBranch || "main"
    });
    timeline.push({ step: "worktree", ...worktree });
    if (worktree.ok) workspace = workspaceFromSession(config, baseWorkspace, session.id);
  }

  const fastTask = workspace.fastTask && workspace.fastTask.enabled !== false ? workspace.fastTask : null;
  const shouldBuildIndex = args.buildIndex !== false && !(args.buildIndex == null && fastTask && fastTask.skipIndexForSmallTasks !== false);
  if (shouldBuildIndex) {
    const index = indexer.buildIndex(config, workspace, { sessionId: session.id, maxFiles: args.maxIndexFiles || (fastTask && fastTask.maxIndexFiles) });
    timeline.push({ step: "index", ok: true, fileCount: index.fileCount, skippedCount: index.skippedCount });
  } else if (fastTask) {
    timeline.push({ step: "index", ok: true, skipped: true, reason: "fastTask.skipIndexForSmallTasks" });
  }

  const plan = ensurePlan(config, session, baseWorkspace, args, mode, goal || session.goal);
  timeline.push({ step: "plan", ok: true, planId: plan.id, status: plan.status, stepCount: plan.steps.length });

  if (mode === "plan_only") {
    sessions.updateSession(config, { sessionId: session.id, status: "planned", summary: "Plan created. No implementation was attempted." });
    return { ok: true, mode, session: sessions.readSession(config, session.id), plan, timeline, nextActions: planOnlyNextActions(session.id, plan.id) };
  }

  if (mode === "review_only") {
    const review = await reviewSession(config, workspace, { sessionId: session.id });
    sessions.updateSession(config, { sessionId: session.id, status: "reviewed", summary: "Review snapshot captured." });
    return { ok: true, mode, session: sessions.readSession(config, session.id), plan, review, timeline };
  }

  const patches = Array.isArray(args.patches) ? args.patches.filter((patch) => String(patch || "").trim()) : [];
  if (patches.length === 0) {
    sessions.appendStep(config, {
      sessionId: session.id,
      type: "task-run",
      title: "Task runner paused for implementation",
      details: "No patches were supplied. Use this snapshot to decide edits, then call relai_apply_patch_and_run or relai_task_run with patches.",
      data: { ok: true, mode, planId: plan.id }
    });
    return {
      ok: true,
      paused: true,
      mode,
      session: sessions.readSession(config, session.id),
      plan,
      timeline,
      nextActions: implementationNextActions(session.id, plan.id)
    };
  }

  const cycles = [];
  for (let i = 0; i < patches.length; i += 1) {
    const cycle = await applyPatchAndRun(workspace, config, {
      diff: patches[i],
      testCommandKeys: Array.isArray(args.testCommandKeys) ? args.testCommandKeys : [],
      stopOnFailure: args.stopOnFailure !== false
    });
    cycles.push({ cycle: i + 1, ...cycle });
    sessions.appendStep(config, {
      sessionId: session.id,
      type: "task-cycle",
      title: `Task runner cycle ${i + 1}`,
      details: JSON.stringify(cycle, null, 2),
      data: { ok: cycle.ok, cycle: i + 1 }
    });
    if (!cycle.ok && args.stopOnFailure !== false) break;
  }
  timeline.push({ step: "patch-test-cycles", ok: cycles.every((cycle) => cycle.ok), count: cycles.length });

  const status = await gitStatus(workspace, config);
  const diff = await gitDiff(workspace, config, {});
  timeline.push({ step: "review-diff", ok: diff.ok, clean: status.clean });

  let commit = null;
  let push = null;
  let pr = null;
  if (cycles.every((cycle) => cycle.ok) && mode === "prepare_pr") {
    if (args.commitMessage) {
      commit = await commitAll(workspace, config, args.commitMessage);
      timeline.push({ step: "commit", ...commit });
    }
    if (args.push !== false && commit && commit.ok) {
      push = await pushBranch(workspace, config, args.remote || "origin", args.branchName || null);
      timeline.push({ step: "push", ...push });
    }
    if (args.createPr !== false && push && push.ok) {
      pr = await createPrWithGh(workspace, config, {
        title: args.prTitle || args.title || firstLine(goal || session.goal),
        body: args.prBody || makePrBody(session, cycles, args),
        base: args.base || baseWorkspace.defaultBaseBranch || "main",
        head: args.head,
        draft: args.draft !== false,
        labels: args.labels,
        reviewers: args.reviewers
      });
      timeline.push({ step: "pr", ...pr });
    }
  }

  const ok = cycles.every((cycle) => cycle.ok) && (!commit || commit.ok) && (!push || push.ok) && (!pr || pr.ok);
  sessions.updateSession(config, {
    sessionId: session.id,
    status: ok ? (mode === "prepare_pr" ? "pr-ready" : "implemented") : "needs-repair",
    summary: ok ? "Task runner completed requested mode." : "Task runner stopped with a failed cycle or git/PR action."
  });

  return {
    ok,
    mode,
    session: sessions.readSession(config, session.id),
    plan,
    cycles,
    status,
    diff,
    commit,
    push,
    pr,
    timeline
  };
}

function taskStatus(config, args = {}) {
  const session = sessions.readSession(config, args.sessionId);
  const relatedPlans = plans.listPlans(config, { sessionId: session.id, limit: 20 });
  return { ok: true, session, plans: relatedPlans };
}

function taskStop(config, args = {}) {
  const session = sessions.updateSession(config, { sessionId: args.sessionId, status: "stopped", summary: args.reason || "Stopped by user/tool request." });
  sessions.appendStep(config, { sessionId: args.sessionId, type: "control", title: "Task stopped", details: args.reason || "Stopped." });
  return { ok: true, session };
}

function taskResume(config, args = {}) {
  const session = sessions.updateSession(config, { sessionId: args.sessionId, status: "active", summary: args.note || "Task resumed." });
  sessions.appendStep(config, { sessionId: args.sessionId, type: "control", title: "Task resumed", details: args.note || "Resumed." });
  return { ok: true, session };
}

async function ciWatch(config, workspace, args = {}) {
  const attempts = Math.min(Math.max(Number(args.attempts || 5), 1), 50);
  const intervalMs = Math.min(Math.max(Number(args.intervalSeconds || 10), 1), 300) * 1000;
  const timeline = [];
  for (let i = 0; i < attempts; i += 1) {
    const checks = await prChecksWithGh(workspace, config, args);
    const classification = classifyCheckText(`${checks.result && checks.result.stdout || ""}\n${checks.result && checks.result.stderr || ""}`);
    timeline.push({ attempt: i + 1, ts: new Date().toISOString(), classification, checks });
    if (classification.done) break;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (args.sessionId) {
    sessions.appendStep(config, { sessionId: args.sessionId, type: "ci-watch", title: "Watched PR checks", details: JSON.stringify(timeline, null, 2), data: { ok: true, attempts: timeline.length } });
  }
  const last = timeline[timeline.length - 1];
  return { ok: Boolean(last && last.checks && last.checks.ok), attempts: timeline.length, last: last || null, timeline };
}

async function ciRepairRun(config, workspace, args = {}) {
  const maxCycles = Math.min(Math.max(Number(args.maxCycles || 2), 1), 10);
  const cycles = [];
  for (let i = 0; i < maxCycles; i += 1) {
    const watch = await ciWatch(config, workspace, { ...args, attempts: args.watchAttempts || 1 });
    const failure = watch.last && watch.last.classification && watch.last.classification.failing;
    cycles.push({ cycle: i + 1, watch });
    if (!failure) break;
    if (!args.repairCommandKey && !args.repairCommand) {
      cycles[cycles.length - 1].repair = { ok: false, message: "CI failed, but no repairCommandKey/repairCommand was provided." };
      break;
    }
    const repair = await runConfiguredCommand(workspace, config, { commandKey: args.repairCommandKey, command: args.repairCommand });
    cycles[cycles.length - 1].repair = repair;
    if (!repair.ok) break;
    if (args.commitMessage) {
      cycles[cycles.length - 1].commit = await commitAll(workspace, config, args.commitMessage);
    }
    if (args.push !== false) {
      cycles[cycles.length - 1].push = await pushBranch(workspace, config, args.remote || "origin", args.branchName || null);
    }
  }
  if (args.sessionId) {
    sessions.appendStep(config, { sessionId: args.sessionId, type: "ci-repair", title: "Ran CI repair loop", details: JSON.stringify(cycles, null, 2), data: { ok: cycles.every((cycle) => !cycle.repair || cycle.repair.ok), cycles: cycles.length } });
  }
  return { ok: cycles.every((cycle) => !cycle.repair || cycle.repair.ok), cycles };
}

async function sessionDiff(config, workspace, args = {}) {
  const diff = await gitDiff(workspace, config, { staged: Boolean(args.staged) });
  return { ok: diff.ok, sessionId: args.sessionId || null, workspace: workspace.alias, diff: diff.diff };
}

async function sessionChangedFiles(config, workspace, args = {}) {
  const diff = await gitDiff(workspace, config, { staged: Boolean(args.staged) });
  const files = extractChangedFiles((diff.diff && diff.diff.stdout) || "");
  return { ok: diff.ok, sessionId: args.sessionId || null, workspace: workspace.alias, files, count: files.length };
}

function sessionTestSummary(config, args = {}) {
  const session = sessions.readSession(config, args.sessionId);
  const testSteps = (session.steps || []).filter((step) => /test|ci|check|task-cycle|patch/i.test(`${step.type || ""} ${step.title || ""}`));
  return { ok: true, sessionId: session.id, count: testSteps.length, tests: testSteps.slice(-Number(args.limit || 20)) };
}

async function sessionExport(config, workspace, args = {}) {
  const session = sessions.readSession(config, args.sessionId);
  const relatedPlans = plans.listPlans(config, { sessionId: session.id, limit: 100 });
  const diff = await gitDiff(workspace, config, {});
  const audits = readAudit(config, { limit: args.auditLimit || 200 }).entries.filter((entry) => entry.sessionId === session.id);
  return { ok: true, exportedAt: new Date().toISOString(), session, plans: relatedPlans, diff: diff.diff, audits };
}

function repoProfile(config, workspace, args = {}) {
  const profile = detectRepositoryProfile(workspace.path, workspace);
  return { ok: true, workspace: workspace.alias, root: workspace.path, ...profile };
}

function repoRelevantFiles(config, workspace, args = {}) {
  const terms = Array.isArray(args.terms) ? args.terms.map((term) => String(term).toLowerCase()).filter(Boolean) : [];
  const limit = Math.min(Math.max(Number(args.limit || 40), 1), 500);
  let files;
  try {
    files = indexer.readIndex(config, workspace, args).files || [];
  } catch (_error) {
    files = collectTextFiles(workspace.path, collectOptionsFromWorkspace(workspace)).files.map((file) => ({ path: file, symbols: [] }));
  }
  const scored = [];
  for (const file of files) {
    const haystack = `${file.path}\n${(file.symbols || []).join("\n")}`.toLowerCase();
    let score = 0;
    for (const term of terms) if (haystack.includes(term)) score += 10;
    if (/test|spec|__tests__/i.test(file.path)) score += args.includeTests === false ? -2 : 2;
    if (/package.json|pyproject.toml|go.mod|cargo.toml|pom.xml|build.gradle/i.test(file.path)) score += 3;
    if (score > 0 || terms.length === 0) scored.push({ ...file, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { ok: true, workspace: workspace.alias, terms, files: scored.slice(0, limit) };
}

function repoTestSuggestions(config, workspace) {
  const profile = detectRepositoryProfile(workspace.path, workspace);
  const suggestions = [];
  if (profile.stack.includes("node")) {
    suggestions.push({ key: "test", command: "npm test", reason: "package.json detected" });
    suggestions.push({ key: "lint", command: "npm run lint", reason: "common Node lint command" });
    suggestions.push({ key: "typecheck", command: "npm run typecheck", reason: "common TypeScript validation command" });
  }
  if (profile.stack.includes("python")) suggestions.push({ key: "test", command: "pytest", reason: "Python manifest detected" });
  if (profile.stack.includes("go")) suggestions.push({ key: "test", command: "go test ./...", reason: "go.mod detected" });
  if (profile.stack.includes("rust")) suggestions.push({ key: "test", command: "cargo test", reason: "Cargo.toml detected" });
  return { ok: true, workspace: workspace.alias, configuredTestCommands: Object.keys(workspace.testCommands || {}).sort(), suggestions };
}

function dashboardOpen(_config, args = {}) {
  const baseUrl = String(args.baseUrl || "http://127.0.0.1:3333").replace(/\/$/, "");
  return { ok: true, dashboardUrl: `${baseUrl}/dashboard`, dashboardApiUrl: `${baseUrl}/api/dashboard`, note: "Send Authorization: Bearer <REL_AI_MCP_TOKEN> or use the dashboard token field." };
}

async function reviewSession(config, workspace, args = {}) {
  const status = await gitStatus(workspace, config);
  const diff = await gitDiff(workspace, config, {});
  const changed = extractChangedFiles((diff.diff && diff.diff.stdout) || "");
  return { ok: status.ok && diff.ok, status, changedFiles: changed, diff: diff.diff };
}

function ensurePlan(config, session, baseWorkspace, args, mode, goal) {
  const existing = plans.listPlans(config, { sessionId: session.id, limit: 1 })[0];
  if (existing && !args.forceNewPlan) return plans.readPlan(config, existing.id);
  return plans.createPlan(config, {
    sessionId: session.id,
    workspace: baseWorkspace.baseAlias || baseWorkspace.alias,
    title: args.title || `Rel.AI MCP ${mode} plan`,
    goal,
    steps: Array.isArray(args.steps) && args.steps.length ? args.steps : defaultSteps(mode, args),
    risks: ["Changes should be reviewed before commit, push, and PR.", "Generated changes may need additional project-specific tests."],
    validation: Array.isArray(args.testCommandKeys) ? args.testCommandKeys.map((key) => `Run ${key}`) : []
  });
}

function defaultSteps(mode, args) {
  const tests = Array.isArray(args.testCommandKeys) && args.testCommandKeys.length ? args.testCommandKeys.join(", ") : "configured tests";
  const steps = [
    { title: "Profile repository", details: "Detect manifests, test surface, and relevant source files.", toolHint: "relai_repo_profile" },
    { title: "Build focused context", details: "Read only relevant files before editing.", toolHint: "relai_context_pack" },
    { title: "Implement changes", details: "Apply minimal safe patches in the task worktree.", toolHint: "relai_apply_patch_and_run" },
    { title: "Validate", details: `Run ${tests}.`, toolHint: "relai_run_test_matrix" },
    { title: "Review diff", details: "Summarize changed files, risk, and test results.", toolHint: "relai_session_diff" }
  ];
  if (mode === "prepare_pr") steps.push({ title: "Prepare PR", details: "Commit, push, create draft PR, then watch checks.", toolHint: "relai_create_pr" });
  if (mode === "ci_repair") steps.push({ title: "Repair CI", details: "Watch failed checks and run repair loop if configured.", toolHint: "relai_ci_repair_run" });
  return steps;
}

function normalizeMode(mode) {
  const raw = String(mode || "").trim() || "implement_and_test";
  const aliases = {
    implement: "implement_and_test",
    test: "implement_and_test",
    plan: "plan_only",
    review: "review_only"
  };
  const value = aliases[raw] || raw;
  if (!TASK_MODES.has(value)) throw new Error(`Unsupported mode: ${raw}. Allowed: ${[...TASK_MODES].join(", ")} plus aliases: implement, test, plan, review`);
  return value;
}

function classifyCheckText(text) {
  const body = String(text || "");
  const failing = /fail|failed|failure|error|cancelled|timed out/i.test(body);
  const pending = /pending|queued|in_progress|waiting|expected/i.test(body);
  const passing = !failing && /pass|success|successful|neutral|skipped/i.test(body);
  return { failing, pending, passing, done: failing || passing || !pending };
}

function extractChangedFiles(diffText) {
  const files = new Set();
  for (const line of String(diffText || "").split(/\r?\n/)) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) files.add(match[2]);
  }
  return [...files].sort();
}

function detectRepositoryProfile(root, workspace) {
  const manifests = [];
  const stack = [];
  const packageManagers = [];
  for (const file of ["package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb", "pyproject.toml", "requirements.txt", "poetry.lock", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "composer.json", "Gemfile", "pubspec.yaml"]) {
    if (fs.existsSync(path.join(root, file))) manifests.push(file);
  }
  if (manifests.includes("package.json")) stack.push("node");
  if (manifests.includes("pyproject.toml") || manifests.includes("requirements.txt")) stack.push("python");
  if (manifests.includes("go.mod")) stack.push("go");
  if (manifests.includes("Cargo.toml")) stack.push("rust");
  if (manifests.includes("pom.xml") || manifests.includes("build.gradle")) stack.push("java");
  if (manifests.includes("pnpm-lock.yaml")) packageManagers.push("pnpm");
  if (manifests.includes("yarn.lock")) packageManagers.push("yarn");
  if (manifests.includes("package-lock.json")) packageManagers.push("npm");
  return {
    manifests,
    stack,
    packageManagers,
    configuredTestCommands: Object.keys(workspace.testCommands || {}).sort(),
    configuredCommands: Object.keys(workspace.commands || {}).sort()
  };
}

function firstLine(text) {
  return String(text || "Rel.AI MCP task").split(/\r?\n/)[0].slice(0, 120) || "Rel.AI MCP task";
}

function makePrBody(session, cycles, args) {
  return [
    "Created by Rel.AI MCP.",
    "",
    `Session: ${session.id}`,
    `Goal: ${session.goal}`,
    "",
    "Validation:",
    ...(cycles.length ? cycles.map((cycle) => `- Cycle ${cycle.cycle}: ${cycle.ok ? "passed" : "failed"}`) : ["- Not run"]),
    "",
    args.prBodyExtra || ""
  ].join("\n");
}

function planOnlyNextActions(sessionId, planId) {
  return [
    `Review plan ${planId}`,
    `Call relai_context_pack with sessionId ${sessionId}`,
    "Call relai_apply_patch_and_run once a patch is ready"
  ];
}

function implementationNextActions(sessionId, planId) {
  return [
    `Use relai_read_files/relai_context_pack for session ${sessionId}`,
    `Update plan ${planId} as implementation details become clear`,
    "Call relai_task_run again with patches, or call relai_apply_patch_and_run directly"
  ];
}

module.exports = {
  taskRun,
  taskStatus,
  taskStop,
  taskResume,
  ciWatch,
  ciRepairRun,
  sessionDiff,
  sessionChangedFiles,
  sessionTestSummary,
  sessionExport,
  repoProfile,
  repoRelevantFiles,
  repoTestSuggestions,
  dashboardOpen
};
