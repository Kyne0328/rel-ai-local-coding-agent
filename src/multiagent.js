const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getStateDir } = require("./audit");
const sessions = require("./sessions");
const plans = require("./plans");
const indexer = require("./indexer");
const taskRunner = require("./taskRunner");
const { createTaskWorktree, workspaceFromSession } = require("./worktrees");
const { runGit, gitDiff, gitStatus, gitShow, prChecksWithGh } = require("./git");
const { summarizeCommand } = require("./process");
const { safeReadJson } = require("./safety");

function multiagentDir(config) {
  return path.join(getStateDir(config), "multiagent");
}

function subtaskDir(config) {
  return path.join(multiagentDir(config), "subtasks");
}

function validateSubtaskId(subtaskId) {
  const id = String(subtaskId || "").trim();
  if (!/^subtask-[A-Za-z0-9_.-]{8,140}$/.test(id)) throw new Error(`Invalid subtask id: ${id}`);
  return id;
}

function makeSubtaskId() {
  return `subtask-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
}

function subtaskPath(config, subtaskId) {
  return path.join(subtaskDir(config), `${validateSubtaskId(subtaskId)}.json`);
}

function writeSubtask(config, subtask) {
  fs.mkdirSync(subtaskDir(config), { recursive: true, mode: 0o700 });
  subtask.updatedAt = new Date().toISOString();
  fs.writeFileSync(subtaskPath(config, subtask.id), `${JSON.stringify(subtask, null, 2)}\n`, { mode: 0o600 });
  return subtask;
}

function readSubtask(config, subtaskId) {
  const file = subtaskPath(config, subtaskId);
  if (!fs.existsSync(file)) throw new Error(`Subtask not found: ${subtaskId}`);
  const data = safeReadJson(file);
  if (!data) throw new Error(`Subtask file corrupted: ${subtaskId}`);
  return data;
}

function listSubtasks(config, options = {}) {
  const dir = subtaskDir(config);
  if (!fs.existsSync(dir)) return [];
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 1000);
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); }
      catch (_error) { return null; }
    })
    .filter(Boolean)
    .filter((item) => !options.parentSessionId || item.parentSessionId === options.parentSessionId)
    .filter((item) => !options.status || item.status === options.status)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit)
    .map(summarizeSubtask);
}

function summarizeSubtask(item) {
  return {
    id: item.id,
    parentSessionId: item.parentSessionId || null,
    sessionId: item.sessionId || null,
    workspace: item.workspace,
    role: item.role,
    title: item.title,
    status: item.status,
    branch: item.branch || null,
    dependsOn: item.dependsOn || [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    resultSummary: item.resultSummary || ""
  };
}

function taskSplit(config, baseWorkspace, args = {}) {
  let parentSession = null;
  if (args.sessionId) {
    parentSession = sessions.readSession(config, args.sessionId);
  } else {
    parentSession = sessions.createSession(config, {
      workspace: baseWorkspace.baseAlias || baseWorkspace.alias,
      goal: args.goal || args.task || "Multi-agent task",
      branch: args.branchName || null
    });
  }

  const goal = String(args.goal || args.task || parentSession.goal || "").trim();
  const rawItems = normalizeSplitItems(args, goal);
  const created = rawItems.map((item, index) => createSubtask(config, baseWorkspace, {
    parentSessionId: parentSession.id,
    workspace: baseWorkspace.baseAlias || baseWorkspace.alias,
    role: item.role,
    title: item.title,
    goal: item.goal,
    dependsOn: item.dependsOn,
    branchName: args.branchPrefix ? `${String(args.branchPrefix).replace(/\/$/, "")}/${slug(item.title || item.role || `subtask-${index + 1}`)}` : undefined,
    createSession: true,
    createWorktree: args.createWorktrees === true,
    fromRef: args.fromRef
  }));

  sessions.appendStep(config, {
    sessionId: parentSession.id,
    type: "multi-agent-split",
    title: "Split task into subtasks",
    details: JSON.stringify(created.map(summarizeSubtask), null, 2),
    data: { ok: true, subtaskIds: created.map((item) => item.id), count: created.length }
  });

  return { ok: true, parentSession, subtasks: created.map(summarizeSubtask), strategy: args.strategy || "role-based" };
}

function normalizeSplitItems(args, goal) {
  if (Array.isArray(args.subtasks) && args.subtasks.length) {
    return args.subtasks.slice(0, Math.min(Math.max(Number(args.maxSubtasks || 12), 1), 50)).map((item, index) => ({
      role: String(item.role || defaultRole(index)),
      title: String(item.title || `${defaultRole(index)} subtask`),
      goal: String(item.goal || item.details || goal),
      dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : []
    }));
  }
  const count = Math.min(Math.max(Number(args.count || 4), 1), 12);
  const templates = [
    { role: "planner", title: "Map relevant files and implementation plan", goal: `Analyze the task and identify likely relevant files, risks, and validation for: ${goal}` },
    { role: "implementer", title: "Implement the core code changes", goal: `Make the smallest safe code changes needed for: ${goal}`, dependsOn: ["planner"] },
    { role: "tester", title: "Add or update validation", goal: `Add/update tests or run configured validation for: ${goal}`, dependsOn: ["implementer"] },
    { role: "reviewer", title: "Review diff, risks, and PR readiness", goal: `Review the final diff for bugs, risky files, missing tests, and PR readiness for: ${goal}`, dependsOn: ["implementer", "tester"] },
    { role: "ci-repair", title: "Repair CI failures after PR checks", goal: `Watch and repair CI failures for: ${goal}`, dependsOn: ["reviewer"] }
  ];
  return templates.slice(0, count);
}

function defaultRole(index) {
  return ["planner", "implementer", "tester", "reviewer", "ci-repair"][index] || `agent-${index + 1}`;
}

function createSubtask(config, baseWorkspace, args = {}) {
  const now = new Date().toISOString();
  const workspaceAlias = String(args.workspace || baseWorkspace.baseAlias || baseWorkspace.alias || "");
  const subtask = {
    id: makeSubtaskId(),
    parentSessionId: args.parentSessionId || null,
    sessionId: null,
    workspace: workspaceAlias,
    role: String(args.role || "implementer"),
    title: String(args.title || "Subtask").slice(0, 200),
    goal: String(args.goal || args.title || "Subtask"),
    status: "created",
    branch: args.branchName || null,
    dependsOn: Array.isArray(args.dependsOn) ? args.dependsOn.map(String) : [],
    createdAt: now,
    updatedAt: now,
    resultSummary: "",
    lastResult: null
  };

  if (args.createSession !== false) {
    const session = sessions.createSession(config, {
      workspace: workspaceAlias,
      goal: `[${subtask.role}] ${subtask.goal}`,
      branch: args.branchName || null
    });
    subtask.sessionId = session.id;
    subtask.status = "session-created";
    if (subtask.parentSessionId) {
      sessions.appendStep(config, {
        sessionId: subtask.parentSessionId,
        type: "subtask",
        title: `Created ${subtask.role} subtask`,
        details: `${subtask.title}\n\n${subtask.goal}`,
        data: { subtaskId: subtask.id, sessionId: session.id, role: subtask.role }
      });
    }
  }

  const saved = writeSubtask(config, subtask);
  return saved;
}

async function createSubtaskWorktree(config, baseWorkspace, subtask, args = {}) {
  if (!subtask.sessionId) throw new Error("Subtask has no attached session.");
  const branchName = args.branchName || subtask.branch || `relai/${slug(subtask.role)}/${subtask.id}`;
  const worktree = await createTaskWorktree(config, baseWorkspace, {
    sessionId: subtask.sessionId,
    branchName,
    fromRef: args.fromRef || baseWorkspace.defaultBaseBranch || "main"
  });
  if (worktree.ok) {
    subtask.branch = worktree.branch;
    subtask.status = "worktree-created";
    subtask.worktreePath = worktree.worktreePath;
    writeSubtask(config, subtask);
  }
  return worktree;
}

async function subtaskCreate(config, baseWorkspace, args = {}) {
  const subtask = createSubtask(config, baseWorkspace, args);
  let worktree = null;
  if (args.createWorktree === true) {
    worktree = await createSubtaskWorktree(config, baseWorkspace, subtask, args);
  }
  return { ok: true, subtask: readSubtask(config, subtask.id), worktree };
}

async function subtaskRun(config, baseWorkspace, args = {}) {
  const subtask = readSubtask(config, args.subtaskId);
  if (subtask.dependsOn && subtask.dependsOn.length && args.ignoreDependencies !== true) {
    const blockers = unresolvedDependencies(config, subtask);
    if (blockers.length) throw new Error(`Subtask has unresolved dependencies: ${blockers.join(", ")}`);
  }
  if (!subtask.sessionId) {
    const session = sessions.createSession(config, { workspace: subtask.workspace, goal: `[${subtask.role}] ${subtask.goal}`, branch: subtask.branch || null });
    subtask.sessionId = session.id;
  }
  if (args.createWorktree === true && !sessions.readSession(config, subtask.sessionId).worktreePath) {
    await createSubtaskWorktree(config, baseWorkspace, subtask, args);
  }
  const mode = args.mode || roleMode(subtask.role);
  const result = await taskRunner.taskRun(config, baseWorkspace, {
    ...args,
    sessionId: subtask.sessionId,
    goal: subtask.goal,
    mode,
    createWorktree: args.createWorktree !== false,
    buildIndex: args.buildIndex !== false,
    branchName: args.branchName || subtask.branch || undefined
  });
  subtask.status = result.ok && !result.paused ? "completed" : (result.paused ? "paused" : "needs-repair");
  subtask.resultSummary = summarizeRunResult(result);
  subtask.lastResult = compactResult(result);
  writeSubtask(config, subtask);
  if (subtask.parentSessionId) {
    sessions.appendStep(config, {
      sessionId: subtask.parentSessionId,
      type: "subtask-run",
      title: `Ran ${subtask.role} subtask`,
      details: JSON.stringify({ subtaskId: subtask.id, status: subtask.status, resultSummary: subtask.resultSummary }, null, 2),
      data: { ok: result.ok, subtaskId: subtask.id, sessionId: subtask.sessionId, role: subtask.role }
    });
  }
  return { ok: Boolean(result.ok), subtask: summarizeSubtask(subtask), result };
}

function unresolvedDependencies(config, subtask) {
  const all = listAllSubtasks(config).filter((item) => item.parentSessionId === subtask.parentSessionId);
  const byRole = new Map(all.map((item) => [item.role, item]));
  const byId = new Map(all.map((item) => [item.id, item]));
  return subtask.dependsOn.filter((dep) => {
    const item = byId.get(dep) || byRole.get(dep);
    return item && !["completed", "reviewed", "merged"].includes(item.status);
  });
}

function listAllSubtasks(config) {
  const dir = subtaskDir(config);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); }
    catch (_error) { return null; }
  }).filter(Boolean);
}

function roleMode(role) {
  const value = String(role || "").toLowerCase();
  if (value.includes("plan")) return "plan_only";
  if (value.includes("review")) return "review_only";
  if (value.includes("ci")) return "ci_repair";
  if (value.includes("test")) return "implement_and_test";
  return "implement_and_test";
}

function summarizeRunResult(result) {
  if (result.paused) return "Paused for implementation input.";
  if (result.ok) return `Completed mode ${result.mode || "unknown"}.`;
  return `Needs repair after mode ${result.mode || "unknown"}.`;
}

function compactResult(result) {
  return {
    ok: Boolean(result.ok),
    paused: Boolean(result.paused),
    mode: result.mode,
    sessionId: result.session && result.session.id,
    planId: result.plan && result.plan.id,
    timeline: Array.isArray(result.timeline) ? result.timeline.map((item) => ({ step: item.step, ok: item.ok })) : []
  };
}

async function subtaskMergeBack(config, baseWorkspace, args = {}) {
  const subtask = readSubtask(config, args.subtaskId);
  if (!subtask.sessionId) throw new Error("Subtask has no session to merge from.");
  const session = sessions.readSession(config, subtask.sessionId);
  const sourceBranch = String(args.sourceBranch || session.branch || subtask.branch || "").trim();
  const targetBranch = String(args.targetBranch || baseWorkspace.defaultBaseBranch || "main").trim();
  if (!sourceBranch) throw new Error("sourceBranch is required and could not be inferred from subtask/session.");

  const preflight = await mergePreflight(config, baseWorkspace, sourceBranch, targetBranch);
  if (args.dryRun !== false) {
    return { ok: preflight.ok, dryRun: true, subtask: summarizeSubtask(subtask), sourceBranch, targetBranch, preflight };
  }
  if (!preflight.ok) return { ok: false, subtask: summarizeSubtask(subtask), sourceBranch, targetBranch, preflight, message: "Merge preflight failed; merge was not attempted." };
  const current = await runGit(["branch", "--show-current"], baseWorkspace, config);
  const checkout = await runGit(["switch", targetBranch], baseWorkspace, config);
  if (checkout.exitCode !== 0) return { ok: false, checkout: summarizeCommand(checkout), message: "Could not switch to target branch." };
  const merge = await runGit(["merge", "--no-ff", sourceBranch, "-m", args.message || `Merge ${subtask.title}`], baseWorkspace, config);
  const restore = current.stdout.trim() && current.stdout.trim() !== targetBranch ? await runGit(["switch", current.stdout.trim()], baseWorkspace, config) : null;
  const ok = merge.exitCode === 0;
  subtask.status = ok ? "merged" : "merge-failed";
  subtask.resultSummary = ok ? `Merged ${sourceBranch} into ${targetBranch}.` : `Merge failed from ${sourceBranch} into ${targetBranch}.`;
  subtask.merge = { sourceBranch, targetBranch, ok, at: new Date().toISOString() };
  writeSubtask(config, subtask);
  if (subtask.parentSessionId) {
    sessions.appendStep(config, { sessionId: subtask.parentSessionId, type: "subtask-merge", title: `Merged ${subtask.role} subtask`, details: JSON.stringify({ sourceBranch, targetBranch, ok }, null, 2), data: { ok, subtaskId: subtask.id } });
  }
  return { ok, subtask: summarizeSubtask(subtask), sourceBranch, targetBranch, merge: summarizeCommand(merge), ...(restore ? { restore: summarizeCommand(restore) } : {}) };
}

async function mergePreflight(config, workspace, sourceBranch, targetBranch) {
  const base = await runGit(["merge-base", targetBranch, sourceBranch], workspace, config);
  if (base.exitCode !== 0) return { ok: false, error: "Could not find merge base.", base: summarizeCommand(base) };
  const baseSha = base.stdout.trim();
  const changed = await runGit(["diff", "--name-only", targetBranch, sourceBranch], workspace, config);
  const tree = await runGit(["merge-tree", baseSha, targetBranch, sourceBranch], workspace, config);
  const text = `${tree.stdout || ""}\n${tree.stderr || ""}`;
  const conflict = /<<<<<<<|changed in both|CONFLICT \(/i.test(text);
  return {
    ok: changed.exitCode === 0 && tree.exitCode === 0 && !conflict,
    mergeBase: baseSha,
    changedFiles: changed.stdout ? changed.stdout.split(/\r?\n/).filter(Boolean) : [],
    conflict,
    mergeTree: summarizeCommand(tree)
  };
}

async function conflictCheck(config, baseWorkspace, args = {}) {
  const items = resolveSubtasksForCheck(config, args);
  const fileMap = new Map();
  const perSubtask = [];
  for (const subtask of items) {
    if (!subtask.sessionId) continue;
    let workspace = baseWorkspace;
    try { workspace = workspaceFromSession(config, baseWorkspace, subtask.sessionId); }
    catch (_error) { workspace = baseWorkspace; }
    const diff = await gitDiff(workspace, config, {});
    const files = changedFilesFromDiff(diff.diff && diff.diff.stdout || "");
    perSubtask.push({ subtaskId: subtask.id, role: subtask.role, sessionId: subtask.sessionId, files });
    for (const file of files) {
      if (!fileMap.has(file)) fileMap.set(file, []);
      fileMap.get(file).push(subtask.id);
    }
  }
  const conflicts = [...fileMap.entries()].filter(([, ids]) => ids.length > 1).map(([pathName, subtaskIds]) => ({ path: pathName, subtaskIds }));
  return { ok: conflicts.length === 0, parentSessionId: args.parentSessionId || null, subtasks: perSubtask, conflicts };
}

function resolveSubtasksForCheck(config, args) {
  if (Array.isArray(args.subtaskIds) && args.subtaskIds.length) return args.subtaskIds.map((id) => readSubtask(config, id));
  if (args.parentSessionId) return listAllSubtasks(config).filter((item) => item.parentSessionId === args.parentSessionId);
  throw new Error("Provide subtaskIds or parentSessionId.");
}

function changedFilesFromDiff(diffText) {
  const files = new Set();
  for (const line of String(diffText || "").split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/);
      if (match) files.add(match[2]);
    } else if (line.startsWith("+++ b/")) {
      files.add(line.slice(6).trim().split(/\s+/)[0]);
    }
  }
  return [...files].filter(Boolean).sort();
}

async function agentReviewDiff(config, workspace, args = {}) {
  const diffResult = args.rev ? await gitShow(workspace, config, args.rev) : await gitDiff(workspace, config, { staged: Boolean(args.staged) });
  const diffText = args.rev ? (diffResult.result && diffResult.result.stdout || "") : (diffResult.diff && diffResult.diff.stdout || "");
  const review = reviewDiffText(diffText, args);
  if (args.sessionId) {
    sessions.appendStep(config, { sessionId: args.sessionId, type: "agent-review", title: "Reviewed current diff", details: JSON.stringify(review, null, 2), data: { ok: review.riskLevel !== "high", riskLevel: review.riskLevel } });
  }
  return { ok: true, workspace: workspace.alias, review, source: args.rev ? args.rev : "current-diff" };
}

function reviewDiffText(diffText, args = {}) {
  const lines = String(diffText || "").split(/\r?\n/);
  const files = changedFilesFromDiff(diffText);
  const additions = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const deletions = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  const findings = [];
  if (!diffText.trim()) findings.push(finding("info", "No diff content was found to review."));
  const secretish = files.filter((file) => /(^|\/)(\.env|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519)|\.(pem|key|p12|pfx)$/i.test(file));
  if (secretish.length) findings.push(finding("high", `Diff touches secret-looking paths: ${secretish.join(", ")}`));
  const sourceFiles = files.filter((file) => /\.(js|jsx|ts|tsx|py|go|rs|java|kt|php|rb|cs|cpp|c|h|swift)$/i.test(file));
  const testFiles = files.filter((file) => /(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\.[jt]sx?$|_test\.go$|Test\.java$/i.test(file));
  if (sourceFiles.length && !testFiles.length) findings.push(finding("medium", "Source files changed without obvious test files changed."));
  if (files.some((file) => /package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock/i.test(file))) findings.push(finding("medium", "Lockfile changed; verify dependency changes are intentional."));
  if (files.some((file) => /migrations?|schema|prisma/i.test(file))) findings.push(finding("medium", "Schema or migration-looking files changed; verify migration compatibility."));
  if (additions + deletions > Number(args.largeDiffThreshold || 800)) findings.push(finding("medium", `Large diff: ${additions} additions and ${deletions} deletions.`));
  if (/TODO|FIXME|HACK/i.test(diffText)) findings.push(finding("low", "Diff contains TODO/FIXME/HACK markers."));
  if (/console\.log|debugger;/i.test(diffText)) findings.push(finding("low", "Diff contains console.log or debugger statements."));
  const riskLevel = findings.some((item) => item.severity === "high") ? "high" : findings.some((item) => item.severity === "medium") ? "medium" : "low";
  return {
    riskLevel,
    files,
    stats: { additions, deletions, fileCount: files.length },
    findings,
    checklist: [
      "Run targeted tests for changed modules.",
      "Run lint/typecheck when available.",
      "Review generated/lockfile changes manually.",
      "Confirm no credentials or local-only paths are included.",
      "Confirm public API and migration compatibility if touched."
    ]
  };
}

function finding(severity, message) { return { severity, message }; }

async function prReviewSummary(config, workspace, args = {}) {
  if (!config.allowGitHubCli) throw new Error("GitHub CLI is disabled. Set allowGitHubCli: true in config.json.");
  const selector = args.pr ? String(args.pr) : "";
  const pr = await runGh(workspace, config, ["pr", "view", ...(selector ? [selector] : []), "--json", "number,title,state,author,baseRefName,headRefName,url,body,changedFiles,additions,deletions,reviewDecision,mergeable"]);
  let parsed = null;
  try { parsed = pr.stdout ? JSON.parse(pr.stdout) : null; } catch (_error) {}
  const checks = await prChecksWithGh(workspace, config, { pr: selector || undefined });
  const diff = await runGh(workspace, config, ["pr", "diff", ...(selector ? [selector] : [])]);
  const review = reviewDiffText(diff.stdout || "", args);
  return { ok: pr.exitCode === 0, pr: parsed, prRaw: summarizeCommand(pr), checks, review };
}

async function agentReviewPr(config, workspace, args = {}) {
  const summary = await prReviewSummary(config, workspace, args);
  if (args.sessionId) {
    sessions.appendStep(config, { sessionId: args.sessionId, type: "pr-review", title: "Reviewed PR", details: JSON.stringify(summary, null, 2), data: { ok: summary.ok, riskLevel: summary.review && summary.review.riskLevel } });
  }
  return summary;
}

async function runGh(workspace, config, ghArgs) {
  const { runProcess } = require("./process");
  return runProcess("gh", ghArgs, { cwd: workspace.path, shell: false }, config);
}

function taskGraph(config, args = {}) {
  const sessionId = args.sessionId || args.parentSessionId;
  if (!sessionId) throw new Error("sessionId or parentSessionId is required.");
  const parent = sessions.readSession(config, sessionId);
  const subtasks = listAllSubtasks(config).filter((item) => item.parentSessionId === sessionId).map(summarizeSubtask);
  const planList = plans.listPlans(config, { sessionId, limit: 20 });
  const edges = [];
  for (const subtask of subtasks) {
    for (const dep of subtask.dependsOn || []) edges.push({ from: dep, to: subtask.id });
  }
  return { ok: true, parent, plans: planList, subtasks, edges };
}

function multiagentStatus(config, args = {}) {
  const subtasks = listSubtasks(config, { parentSessionId: args.parentSessionId, status: args.status, limit: args.limit || 200 });
  const counts = subtasks.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  return { ok: true, counts, subtasks };
}

function slug(value) {
  return String(value || "task").toLowerCase().replace(/[^a-z0-9._/-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "task";
}

module.exports = {
  taskSplit,
  subtaskCreate,
  subtaskRun,
  subtaskMergeBack,
  readSubtask,
  listSubtasks,
  conflictCheck,
  agentReviewDiff,
  prReviewSummary,
  agentReviewPr,
  taskGraph,
  multiagentStatus,
  reviewDiffText
};
