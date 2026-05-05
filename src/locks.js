const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getStateDir } = require("./audit");

function locksDir(config) {
  return path.join(getStateDir(config), "locks");
}

function safeKey(value) {
  return String(value || "global").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || "global";
}

function lockPath(config, workspace, resource) {
  return path.join(locksDir(config), `${safeKey(workspace)}--${safeKey(resource)}.json`);
}

function acquireLock(config, args = {}) {
  const workspace = String(args.workspace || "global");
  const resource = String(args.resource || "workspace");
  const file = lockPath(config, workspace, resource);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file) && args.steal !== true) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    throw new Error(`Lock already held by ${existing.owner || existing.id}: ${workspace}/${resource}`);
  }
  const lock = {
    id: `lock-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`,
    workspace,
    resource,
    owner: args.owner ? String(args.owner) : (args.sessionId ? String(args.sessionId) : "rel-ai-mcp"),
    sessionId: args.sessionId ? String(args.sessionId) : null,
    createdAt: new Date().toISOString(),
    note: String(args.note || "").slice(0, 1000)
  };
  fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, lock };
}

function releaseLock(config, args = {}) {
  const workspace = String(args.workspace || "global");
  const resource = String(args.resource || "workspace");
  const file = lockPath(config, workspace, resource);
  if (!fs.existsSync(file)) return { ok: false, message: "Lock does not exist." };
  const lock = JSON.parse(fs.readFileSync(file, "utf8"));
  if (args.lockId && lock.id !== args.lockId) throw new Error(`Lock id mismatch. Existing lock is ${lock.id}.`);
  fs.unlinkSync(file);
  return { ok: true, released: lock };
}

function listLocks(config) {
  const dir = locksDir(config);
  if (!fs.existsSync(dir)) return { ok: true, locks: [] };
  const locks = fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch (_error) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { ok: true, locks };
}

module.exports = { acquireLock, releaseLock, listLocks };
