const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getStateDir } = require("./audit");
const { runGit, gitDiff } = require("./git");
const { summarizeCommand } = require("./process");

function snapshotDir(config) { return path.join(getStateDir(config), "snapshots"); }
function snapshotPath(config, id) { return path.join(snapshotDir(config), `${validateId(id)}.json`); }
function validateId(id) {
  const value = String(id || "").trim();
  if (!/^snap-[A-Za-z0-9_.-]{8,140}$/.test(value)) throw new Error(`Invalid snapshot id: ${value}`);
  return value;
}
function makeId() { return `snap-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`; }

async function createSnapshot(config, workspace, args = {}) {
  const head = await runGit(["rev-parse", "HEAD"], workspace, config);
  const branch = await runGit(["branch", "--show-current"], workspace, config);
  const status = await runGit(["status", "--short"], workspace, config);
  const unstaged = await gitDiff(workspace, config, {});
  const staged = await gitDiff(workspace, config, { staged: true });
  const snapshot = {
    id: makeId(),
    workspace: workspace.baseAlias || workspace.alias,
    sessionId: args.sessionId || null,
    title: String(args.title || args.summary || "Workspace snapshot").slice(0, 200),
    createdAt: new Date().toISOString(),
    root: workspace.path,
    branch: branch.stdout.trim(),
    head: head.stdout.trim(),
    status: status.stdout || "",
    unstagedDiff: unstaged.diff?.stdout || "",
    stagedDiff: staged.diff?.stdout || ""
  };
  fs.mkdirSync(snapshotDir(config), { recursive: true, mode: 0o700 });
  fs.writeFileSync(snapshotPath(config, snapshot.id), `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, snapshot: summarizeSnapshot(snapshot) };
}

function listSnapshots(config, args = {}) {
  const dir = snapshotDir(config);
  if (!fs.existsSync(dir)) return { ok: true, snapshots: [] };
  const limit = Math.min(Math.max(Number(args.limit || 100), 1), 1000);
  const snapshots = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => {
    try { return summarizeSnapshot(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))); }
    catch (_error) { return null; }
  }).filter(Boolean)
    .filter((snap) => !args.workspace || snap.workspace === args.workspace)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
  return { ok: true, snapshots };
}

function readSnapshot(config, id) {
  const file = snapshotPath(config, id);
  if (!fs.existsSync(file)) throw new Error(`Snapshot not found: ${id}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function restoreSnapshot(config, workspace, args = {}) {
  const snapshot = readSnapshot(config, args.snapshotId);
  if (args.dryRun !== false) {
    return { ok: true, dryRun: true, snapshot: summarizeSnapshot(snapshot), message: "Dry run only. Set dryRun=false with approval to restore." };
  }
  const current = await runGit(["rev-parse", "HEAD"], workspace, config);
  if (current.stdout.trim() !== snapshot.head && args.allowDifferentHead !== true) {
    return { ok: false, snapshot: summarizeSnapshot(snapshot), message: `Current HEAD ${current.stdout.trim()} differs from snapshot HEAD ${snapshot.head}. Set allowDifferentHead=true only if you know this is safe.` };
  }
  const reset = await runGit(["reset", "--hard", snapshot.head], workspace, config);
  if (reset.exitCode !== 0) return { ok: false, reset: summarizeCommand(reset) };
  let applyStaged = null;
  let applyUnstaged = null;
  if (snapshot.stagedDiff) applyStaged = await applyDiff(workspace, config, snapshot.stagedDiff, true);
  if (snapshot.unstagedDiff) applyUnstaged = await applyDiff(workspace, config, snapshot.unstagedDiff, false);
  return { ok: (!applyStaged || applyStaged.ok) && (!applyUnstaged || applyUnstaged.ok), snapshot: summarizeSnapshot(snapshot), reset: summarizeCommand(reset), applyStaged, applyUnstaged };
}

async function applyDiff(workspace, config, diff, staged) {
  const tmp = path.join(require("node:os").tmpdir(), `relai-snapshot-${crypto.randomBytes(4).toString("hex")}.diff`);
  fs.writeFileSync(tmp, diff, { mode: 0o600 });
  try {
    const apply = await runGit(["apply", tmp], workspace, config);
    const add = staged && apply.exitCode === 0 ? await runGit(["add", "-A"], workspace, config) : null;
    return { ok: apply.exitCode === 0 && (!add || add.exitCode === 0), apply: summarizeCommand(apply), ...(add ? { add: summarizeCommand(add) } : {}) };
  } finally {
    try { fs.unlinkSync(tmp); } catch (_error) {}
  }
}

function deleteSnapshot(config, args = {}) {
  const file = snapshotPath(config, args.snapshotId);
  if (!fs.existsSync(file)) return { ok: false, message: "Snapshot not found." };
  fs.unlinkSync(file);
  return { ok: true, snapshotId: args.snapshotId };
}

function summarizeSnapshot(snapshot) {
  return { id: snapshot.id, workspace: snapshot.workspace, sessionId: snapshot.sessionId, title: snapshot.title, createdAt: snapshot.createdAt, branch: snapshot.branch, head: snapshot.head, hasStagedDiff: Boolean(snapshot.stagedDiff), hasUnstagedDiff: Boolean(snapshot.unstagedDiff), statusLines: snapshot.status ? snapshot.status.split(/\r?\n/).filter(Boolean).length : 0 };
}

module.exports = { createSnapshot, listSnapshots, readSnapshot, restoreSnapshot, deleteSnapshot };
