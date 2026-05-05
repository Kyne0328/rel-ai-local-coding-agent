const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getStateDir } = require("./audit");

function sessionDir(config) {
  return path.join(getStateDir(config), "sessions");
}

function makeSessionId() {
  return `task-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
}

function validateSessionId(sessionId) {
  const id = String(sessionId || "").trim();
  if (!/^task-[A-Za-z0-9_.-]{10,120}$/.test(id)) throw new Error(`Invalid session id: ${id}`);
  return id;
}

function sessionPath(config, sessionId) {
  return path.join(sessionDir(config), `${validateSessionId(sessionId)}.json`);
}

function createSession(config, args) {
  const now = new Date().toISOString();
  const session = {
    id: makeSessionId(),
    status: "active",
    workspace: String(args.workspace || ""),
    goal: String(args.goal || ""),
    branch: args.branch ? String(args.branch) : null,
    createdAt: now,
    updatedAt: now,
    summary: "",
    steps: []
  };
  if (!session.workspace) throw new Error("workspace is required.");
  if (!session.goal.trim()) throw new Error("goal is required.");
  writeSession(config, session);
  return session;
}

function readSession(config, sessionId) {
  const file = sessionPath(config, sessionId);
  if (!fs.existsSync(file)) throw new Error(`Session not found: ${sessionId}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeSession(config, session) {
  fs.mkdirSync(sessionDir(config), { recursive: true, mode: 0o700 });
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(sessionPath(config, session.id), `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  return session;
}

function listSessions(config, options = {}) {
  const dir = sessionDir(config);
  if (!fs.existsSync(dir)) return [];
  const limit = Math.min(Math.max(Number(options.limit || 50), 1), 500);
  const items = fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        const session = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        return {
          id: session.id,
          status: session.status,
          workspace: session.workspace,
          goal: session.goal,
          branch: session.branch,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          stepCount: Array.isArray(session.steps) ? session.steps.length : 0
        };
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
  return items;
}

function appendStep(config, args) {
  const session = readSession(config, args.sessionId);
  const steps = Array.isArray(session.steps) ? session.steps : [];
  const maxSteps = Math.min(Math.max(Number(config.maxSessionSteps || 200), 20), 2000);
  if (steps.length >= maxSteps) throw new Error(`Session has reached maxSessionSteps (${maxSteps}).`);
  const step = {
    ts: new Date().toISOString(),
    type: String(args.type || "note"),
    title: String(args.title || "").slice(0, 200),
    details: truncate(String(args.details || ""), 30000),
    data: args.data && typeof args.data === "object" ? args.data : undefined
  };
  steps.push(step);
  session.steps = steps;
  return writeSession(config, session);
}

function updateSession(config, args) {
  const session = readSession(config, args.sessionId);
  if (args.status) session.status = String(args.status);
  if (Object.prototype.hasOwnProperty.call(args, "summary")) session.summary = truncate(String(args.summary || ""), 30000);
  if (Object.prototype.hasOwnProperty.call(args, "branch")) session.branch = args.branch ? String(args.branch) : null;
  for (const key of ["worktreePath", "worktreeBaseWorkspace", "worktreeCreatedAt", "worktreeRemovedAt", "prUrl", "lastChecksAt"]) {
    if (Object.prototype.hasOwnProperty.call(args, key)) session[key] = args[key];
  }
  return writeSession(config, session);
}

function truncate(value, max) {
  return value.length <= max ? value : `${value.slice(0, max)}\n[rel-ai-mcp truncated ${value.length - max} chars]`;
}

module.exports = {
  createSession,
  readSession,
  listSessions,
  appendStep,
  updateSession
};
