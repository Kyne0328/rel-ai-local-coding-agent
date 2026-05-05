const multiagent = require("./multiagent");
const { runGit } = require("./git");
const { summarizeCommand } = require("./process");

async function mergePlan(config, workspace, args = {}) {
  const subtasks = multiagent.listSubtasks(config, { parentSessionId: args.parentSessionId, limit: 1000 });
  const candidates = subtasks.filter((item) => ["completed", "reviewed"].includes(item.status));
  const conflict = await multiagent.conflictCheck(config, workspace, { parentSessionId: args.parentSessionId });
  const order = candidates.map((item, index) => ({ order: index + 1, subtaskId: item.id, role: item.role, branch: item.branch, title: item.title, status: item.status }));
  return { ok: conflict.ok, parentSessionId: args.parentSessionId || null, mergeOrder: order, conflicts: conflict.conflicts || [], message: conflict.ok ? "Merge plan has no changed-file overlap." : "Merge plan has changed-file conflicts; resolve before execution." };
}

async function mergeExecute(config, workspace, args = {}) {
  const plan = await mergePlan(config, workspace, args);
  if (args.dryRun !== false) return { ok: plan.ok, dryRun: true, plan };
  if (!plan.ok && args.force !== true) return { ok: false, plan, message: "Merge plan has conflicts. Set force=true only after manual review." };
  const results = [];
  for (const item of plan.mergeOrder) {
    const result = await multiagent.subtaskMergeBack(config, workspace, { subtaskId: item.subtaskId, targetBranch: args.targetBranch, dryRun: false, message: args.message || `Merge ${item.title}` });
    results.push(result);
    if (!result.ok && args.stopOnFailure !== false) break;
  }
  return { ok: results.every((item) => item.ok), plan, results };
}

async function mergeStatus(config, workspace, args = {}) {
  const branch = await runGit(["branch", "--show-current"], workspace, config);
  const status = await runGit(["status", "--short"], workspace, config);
  const plan = args.parentSessionId ? await mergePlan(config, workspace, args) : null;
  return { ok: branch.exitCode === 0 && status.exitCode === 0, branch: branch.stdout.trim(), status: summarizeCommand(status), plan };
}

async function mergeAbort(config, workspace) {
  const result = await runGit(["merge", "--abort"], workspace, config);
  return { ok: result.exitCode === 0, result: summarizeCommand(result) };
}

module.exports = { mergePlan, mergeExecute, mergeStatus, mergeAbort };
