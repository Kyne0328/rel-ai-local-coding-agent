import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readJsonFile, writeJsonAtomic } from '../durableState.js';
import { getStateDir } from '../statePaths.js';
import { principalFingerprint, principalForContext } from '../mcp/principal.js';
import { normalizeAgentResult, normalizeAgentRole, normalizeReasoningLevel } from './contracts.js';

const AGENT_ID = /^agent_[A-Za-z0-9_-]{32,160}$/;
const ACTIVE_STATES = new Set(['pending', 'starting', 'working', 'input_required']);
const RESTART_FAILURE = 'Rel.AI restarted before this delegated agent returned an MCP result. The browser session was closed; create a new delegated agent if the subtask is still needed.';

function createAgent(config, args = {}, context = {}) {
  const parentWorkId = requiredText(args.work_id, 'work_id');
  const workspace = requiredText(args.workspace, 'workspace');
  const ownerFingerprint = principalFingerprint(principalForContext(context, Boolean(context?.publicHttpOnly)));
  const role = normalizeAgentRole(args.role || 'investigator');
  assertAgentCreationAllowed(config, { parentWorkId, workspace, ownerFingerprint, role });
  const agentId = `agent_${crypto.randomBytes(32).toString('base64url')}`;
  const now = new Date().toISOString();
  const record = {
    schemaVersion: 1,
    agentId,
    parentWorkId,
    workspace,
    principalFingerprint: ownerFingerprint,
    role,
    reasoning: normalizeReasoningLevel(args.reasoning || 'medium'),
    objective: boundedText(args.objective, 20_000),
    connectorName: boundedText(args.connectorName || 'Rel.AI MCP', 200),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    attachedAt: null,
    completedAt: null,
    childWorkId: null,
    result: null,
    error: null,
    errorCode: null
  };
  persist(config, record);
  return publicRecord(record);
}

function attachAgent(config, args = {}, context = {}) {
  const record = requireOwnedAgent(config, args.agent_id, context);
  const childWorkId = requiredText(args.work_id, 'work_id');
  const workspace = requiredText(args.workspace, 'workspace');
  if (workspace !== record.workspace) throw agentError('AGENT_WORKSPACE_MISMATCH', 'Delegated agent belongs to a different workspace.');
  if (childWorkId === record.parentWorkId) throw agentError('AGENT_PARENT_TASK_REUSE', 'A delegated agent must use its own child work session.');
  if (record.childWorkId && record.childWorkId !== childWorkId) {
    throw agentError('AGENT_ALREADY_ATTACHED', 'Delegated agent is already attached to a different child work session.');
  }
  if (!ACTIVE_STATES.has(record.status)) return publicRecord(record);
  record.childWorkId = childWorkId;
  if (!record.attachedAt) record.attachedAt = new Date().toISOString();
  record.status = 'working';
  touch(record);
  persist(config, record);
  return publicRecord(record);
}

function getAgentStatus(config, args = {}, context = {}) {
  return publicRecord(requireOwnedAgent(config, args.agent_id, context));
}

function listAgentsForDashboard(config, options = {}) {
  const limit = normalizeDashboardLimit(options.limit);
  let entries;
  try {
    entries = fs.readdirSync(agentDirectory(config), { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter(entry => entry.isFile() && AGENT_ID.test(entry.name.slice(0, -'.json'.length)) && entry.name.endsWith('.json'))
    .map(entry => {
      const agentId = entry.name.slice(0, -'.json'.length);
      try { return readRecord(config, agentId); } catch { return null; }
    })
    .filter(Boolean)
    .sort(compareDashboardAgents)
    .slice(0, limit)
    .map(publicRecord);
}

function cancelAgentForDashboard(config, args = {}) {
  const record = requireAgent(config, args.agent_id);
  if (!ACTIVE_STATES.has(record.status)) return publicRecord(record);
  record.error = boundedText(args.reason || 'Cancelled from Rel.AI desktop.', 2000);
  record.errorCode = null;
  record.status = 'cancelled';
  record.completedAt = new Date().toISOString();
  touch(record);
  persist(config, record);
  return publicRecord(record);
}

function completeAgent(config, args = {}, context = {}) {
  const record = requireOwnedAgent(config, args.agent_id, context);
  if (record.status === 'completed') return publicRecord(record);
  assertActive(record);
  assertChildWork(record, args.child_work_id);
  record.result = normalizeAgentResult(args.result || {});
  record.error = null;
  record.errorCode = null;
  record.status = 'completed';
  record.completedAt = new Date().toISOString();
  touch(record);
  persist(config, record);
  return publicRecord(record);
}

function failAgentLaunch(config, args = {}, context = {}) {
  const record = requireOwnedAgent(config, args.agent_id, context);
  if (record.status === 'failed') return publicRecord(record);
  if (record.status !== 'pending' || record.childWorkId) return publicRecord(record);
  record.result = null;
  record.error = boundedText(args.error || 'Agent runtime failed to start delegated agent.', 12_000);
  record.errorCode = boundedText(args.errorCode || 'AGENT_RUNTIME_START_FAILED', 200) || 'AGENT_RUNTIME_START_FAILED';
  record.status = 'failed';
  record.completedAt = new Date().toISOString();
  touch(record);
  persist(config, record);
  return publicRecord(record);
}

function failAgent(config, args = {}, context = {}) {
  const record = requireOwnedAgent(config, args.agent_id, context);
  if (record.status === 'failed') return publicRecord(record);
  assertActive(record);
  assertChildWork(record, args.child_work_id);
  record.error = boundedText(args.error || 'Agent failed.', 12_000);
  record.errorCode = boundedText(args.errorCode || '', 200) || null;
  record.status = 'failed';
  record.completedAt = new Date().toISOString();
  touch(record);
  persist(config, record);
  return publicRecord(record);
}

function cancelAgent(config, args = {}, context = {}) {
  const record = requireOwnedAgent(config, args.agent_id, context);
  if (record.status === 'cancelled') return publicRecord(record);
  assertActive(record);
  record.error = boundedText(args.reason || 'Agent cancelled.', 2000);
  record.errorCode = null;
  record.status = 'cancelled';
  record.completedAt = new Date().toISOString();
  touch(record);
  persist(config, record);
  return publicRecord(record);
}

function reconcileOrphanedAgents(config, options = {}) {
  const directory = agentDirectory(config);
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { reconciled: 0 };
    throw error;
  }
  const now = String(options.now || new Date().toISOString());
  const reason = boundedText(options.reason || RESTART_FAILURE, 12_000);
  let reconciled = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^agent_[A-Za-z0-9_-]{32,160}\.json$/.test(entry.name)) continue;
    const agentId = entry.name.slice(0, -'.json'.length);
    let record;
    try { record = readRecord(config, agentId); } catch { continue; }
    if (!record || !ACTIVE_STATES.has(record.status)) continue;
    record.result = null;
    record.error = reason;
    record.errorCode = 'AGENT_RESTARTED';
    record.status = 'failed';
    record.completedAt = now;
    record.updatedAt = now;
    persist(config, record);
    reconciled += 1;
  }
  return { reconciled };
}

function requireOwnedAgent(config, agentId, context = {}) {
  const record = requireAgent(config, agentId);
  const actual = principalFingerprint(principalForContext(context, Boolean(context?.publicHttpOnly)));
  if (!safeEqual(record.principalFingerprint, actual)) throw agentError('AGENT_NOT_FOUND', 'Unknown or unavailable delegated agent.');
  return record;
}

function requireAgent(config, agentId) {
  const id = String(agentId || '').trim();
  if (!AGENT_ID.test(id)) throw agentError('AGENT_NOT_FOUND', 'Unknown or unavailable delegated agent.');
  const record = readRecord(config, id);
  if (!record) throw agentError('AGENT_NOT_FOUND', 'Unknown or unavailable delegated agent.');
  return record;
}

function assertAgentCreationAllowed(config, { parentWorkId, workspace, ownerFingerprint, role }) {
  let entries;
  try {
    entries = fs.readdirSync(agentDirectory(config), { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const agentId = entry.name.slice(0, -'.json'.length);
    if (!AGENT_ID.test(agentId)) continue;
    let record;
    try { record = readRecord(config, agentId); } catch { continue; }
    if (!record || !safeEqual(record.principalFingerprint, ownerFingerprint)) continue;
    if (record.childWorkId === parentWorkId) {
      throw agentError('AGENT_RECURSIVE_DELEGATION', 'Delegated child work sessions cannot create additional subagents.');
    }
    if (role === 'implementer' && record.role === 'implementer' && record.workspace === workspace && ACTIVE_STATES.has(record.status)) {
      throw agentError('AGENT_IMPLEMENTER_BUSY', 'Another delegated implementer is already active in this workspace. Finish or cancel it before starting another implementer.');
    }
  }
}

function compareDashboardAgents(left, right) {
  const activeDelta = Number(ACTIVE_STATES.has(right.status)) - Number(ACTIVE_STATES.has(left.status));
  if (activeDelta) return activeDelta;
  return Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0);
}

function normalizeDashboardLimit(value) {
  if (value == null) return 20;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Dashboard agent limit must be an integer between 1 and 100.');
  return limit;
}

function assertActive(record) {
  if (!ACTIVE_STATES.has(record.status)) throw agentError('INVALID_AGENT_STATE', `Delegated agent is already ${record.status}.`);
}

function assertChildWork(record, value) {
  const childWorkId = requiredText(value, 'child_work_id');
  if (!record.childWorkId || record.childWorkId !== childWorkId) {
    throw agentError('AGENT_CHILD_TASK_MISMATCH', 'Delegated agent result does not match its attached child work session.');
  }
}

function agentDirectory(config) {
  return path.join(getStateDir(config), 'agents');
}

function agentPath(config, agentId) {
  return path.join(agentDirectory(config), `${agentId}.json`);
}

function persist(config, record) {
  writeJsonAtomic(agentPath(config, record.agentId), record, { mode: 0o600 });
}

function readRecord(config, agentId) {
  return readJsonFile(agentPath(config, agentId), {
    fallback: null,
    validate: value => Boolean(value && typeof value === 'object' && value.agentId === agentId)
  });
}

function publicRecord(record) {
  return {
    ok: true,
    agent_id: record.agentId,
    parent_work_id: record.parentWorkId,
    workspace: record.workspace,
    role: record.role,
    reasoning: record.reasoning,
    connectorName: record.connectorName,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    attachedAt: record.attachedAt,
    completedAt: record.completedAt,
    child_work_id: record.childWorkId,
    objective: record.objective,
    agentResult: record.result,
    error: record.error,
    errorCode: record.errorCode || null
  };
}

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function boundedText(value, maxChars) {
  return String(value ?? '').trim().slice(0, maxChars);
}

function touch(record) {
  record.updatedAt = new Date().toISOString();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function agentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export {
  attachAgent,
  cancelAgent,
  cancelAgentForDashboard,
  completeAgent,
  createAgent,
  failAgent,
  failAgentLaunch,
  getAgentStatus,
  listAgentsForDashboard,
  reconcileOrphanedAgents
};
