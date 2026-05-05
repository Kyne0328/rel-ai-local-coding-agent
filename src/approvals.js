const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getStateDir } = require("./audit");

const KNOWN_ACTIONS = new Set(["write", "patch", "command", "docker", "commit", "push", "pr", "reset", "worktree-remove"]);

function approvalsDir(config) {
  return path.join(getStateDir(config), "approvals");
}

function makeApprovalId() {
  return `approval-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
}

function validateApprovalId(approvalId) {
  const id = String(approvalId || "").trim();
  if (!/^approval-[A-Za-z0-9_.-]{10,140}$/.test(id)) throw new Error(`Invalid approval id: ${id}`);
  return id;
}

function approvalPath(config, approvalId) {
  return path.join(approvalsDir(config), `${validateApprovalId(approvalId)}.json`);
}

function writeApproval(config, approval) {
  fs.mkdirSync(approvalsDir(config), { recursive: true, mode: 0o700 });
  approval.updatedAt = new Date().toISOString();
  fs.writeFileSync(approvalPath(config, approval.id), `${JSON.stringify(approval, null, 2)}\n`, { mode: 0o600 });
  return approval;
}

function createApproval(config, args = {}) {
  const action = String(args.action || "").trim();
  if (!KNOWN_ACTIONS.has(action)) throw new Error(`Unknown approval action: ${action}`);
  const now = new Date().toISOString();
  const approval = {
    id: makeApprovalId(),
    status: "pending",
    action,
    workspace: args.workspace ? String(args.workspace) : null,
    sessionId: args.sessionId ? String(args.sessionId) : null,
    summary: String(args.summary || "").slice(0, 1000),
    data: args.data && typeof args.data === "object" ? args.data : {},
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    usedAt: null,
    note: ""
  };
  if (!approval.summary) throw new Error("approval summary is required.");
  return writeApproval(config, approval);
}

function readApproval(config, approvalId) {
  const file = approvalPath(config, approvalId);
  if (!fs.existsSync(file)) throw new Error(`Approval not found: ${approvalId}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listApprovals(config, options = {}) {
  const dir = approvalsDir(config);
  if (!fs.existsSync(dir)) return [];
  const limit = Math.min(Math.max(Number(options.limit || 50), 1), 500);
  const status = options.status ? String(options.status) : "";
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch (_error) { return null; }
    })
    .filter(Boolean)
    .filter((item) => !status || item.status === status)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      status: item.status,
      action: item.action,
      workspace: item.workspace,
      sessionId: item.sessionId,
      summary: item.summary,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      resolvedAt: item.resolvedAt,
      usedAt: item.usedAt
    }));
}

function resolveApproval(config, args = {}) {
  const approval = readApproval(config, args.approvalId);
  const status = String(args.status || "").trim();
  if (!["approved", "rejected", "cancelled"].includes(status)) throw new Error("status must be approved, rejected, or cancelled.");
  if (approval.status !== "pending") throw new Error(`Approval is already ${approval.status}.`);
  approval.status = status;
  approval.resolvedAt = new Date().toISOString();
  approval.note = String(args.note || "").slice(0, 2000);
  return writeApproval(config, approval);
}

function actionRequiresApproval(config, action) {
  const gates = config.approvalGates || {};
  return Boolean(gates[action]);
}

function requireApproval(config, action, args = {}) {
  if (!actionRequiresApproval(config, action)) return null;
  const approvalId = args.approvalId ? String(args.approvalId) : "";
  if (!approvalId) {
    throw new Error(`Approval required for action '${action}'. Create approval with relai_approval_request, approve it, then retry with approvalId.`);
  }
  const approval = readApproval(config, approvalId);
  if (approval.action !== action) throw new Error(`Approval ${approvalId} is for '${approval.action}', not '${action}'.`);
  if (approval.workspace && args.workspace && approval.workspace !== args.workspace) {
    throw new Error(`Approval ${approvalId} is scoped to workspace '${approval.workspace}', not '${args.workspace}'.`);
  }
  if (approval.sessionId && args.sessionId && approval.sessionId !== args.sessionId) {
    throw new Error(`Approval ${approvalId} is scoped to session '${approval.sessionId}', not '${args.sessionId}'.`);
  }
  if (approval.status !== "approved") throw new Error(`Approval ${approvalId} is ${approval.status}, not approved.`);
  if (approval.usedAt) throw new Error(`Approval ${approvalId} was already used at ${approval.usedAt}.`);
  approval.usedAt = new Date().toISOString();
  return writeApproval(config, approval);
}

module.exports = {
  createApproval,
  readApproval,
  listApprovals,
  resolveApproval,
  requireApproval,
  actionRequiresApproval
};
