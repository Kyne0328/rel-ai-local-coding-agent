import { getCurrentToolActivityContext } from './toolActivity.js';
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runProcess } from './process.js';
import { gitStatusArgs, parseGitStatus } from "./repo/gitStatus.js";

const SESSION_IDLE_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_TOUCH_PERSIST_INTERVAL_MS = 60 * 1000;
const policyCache = new Map();

function sessionsDir(config) {
  const stateDir = config.stateDir || path.join(os.homedir(), '.rel-ai-mcp');
  return path.join(stateDir, 'sessions');
}

function legacySessionFilePath(config, alias) {
  return path.join(sessionsDir(config), `${alias}-policy.json`);
}

function taskSessionFilePath(config, alias, taskId) {
  return path.join(sessionsDir(config), `${encodeURIComponent(alias)}--${encodeURIComponent(taskId)}-policy.json`);
}

function currentTaskId() {
  try {
    return String(getCurrentToolActivityContext()?.taskId || '').trim();
  } catch {
    return '';
  }
}

function resolvedTaskId(taskId) {
  return String(taskId || currentTaskId() || '').trim();
}

function sessionLastActivity(parsed) {
  const stamp = parsed && (parsed.updatedAt || parsed.createdAt);
  const ms = Date.parse(stamp || '');
  return Number.isFinite(ms) ? ms : null;
}

function readPolicyFile(filePath, alias, expectedTaskId = '') {
  try {
    const cached = policyCache.get(filePath);
    if (cached && cached.fileRevision === policyFileRevision(filePath)) {
      if (!validPolicy(cached.policy, alias, expectedTaskId)) return null;
      if (isExpiredPolicy(cached.policy)) {
        policyCache.delete(filePath);
        return null;
      }
      return structuredClone(cached.policy);
    }
    if (cached) policyCache.delete(filePath);
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!validPolicy(parsed, alias, expectedTaskId) || isExpiredPolicy(parsed)) return null;
    cachePolicy(filePath, parsed, sessionLastActivity(parsed) || Date.now());
    return structuredClone(parsed);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session policy read:', error);
    return null;
  }
}

function validPolicy(parsed, alias, expectedTaskId = '') {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (parsed.workspace !== alias) return false;
  return !expectedTaskId || String(parsed.taskId || '') === expectedTaskId;
}

function isExpiredPolicy(parsed) {
  const last = sessionLastActivity(parsed);
  return last !== null && Date.now() - last > SESSION_IDLE_TTL_MS;
}

function cachePolicy(filePath, policy, lastPersistedAt = Date.now(), fileRevision = policyFileRevision(filePath)) {
  policyCache.set(filePath, { policy: structuredClone(policy), lastPersistedAt, fileRevision });
}

function policyFileRevision(filePath) {
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    return `${stat.size}:${stat.mtimeNs}`;
  } catch {
    return '';
  }
}

function readSessionPolicies(config, alias) {
  const directory = sessionsDir(config);
  const policies = [];
  const legacy = readPolicyFile(legacySessionFilePath(config, alias), alias);
  if (legacy) policies.push(legacy);
  try {
    if (!fs.existsSync(directory)) return policies;
    const prefix = `${encodeURIComponent(alias)}--`;
    for (const name of fs.readdirSync(directory)) {
      if (!name.startsWith(prefix) || !name.endsWith('-policy.json')) continue;
      const parsed = readPolicyFile(path.join(directory, name), alias);
      if (parsed) policies.push(parsed);
    }
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session policy list:', error);
  }
  const byTask = new Map();
  for (const policy of policies) {
    const key = String(policy.taskId || `legacy:${policy.createdAt || ''}`);
    byTask.set(key, policy);
  }
  return [...byTask.values()];
}

function readSessionPolicy(config, alias, taskId = '') {
  const resolved = resolvedTaskId(taskId);
  if (resolved) {
    const taskPolicy = readPolicyFile(taskSessionFilePath(config, alias, resolved), alias, resolved);
    if (taskPolicy) return taskPolicy;
    const legacy = readPolicyFile(legacySessionFilePath(config, alias), alias);
    return legacy && String(legacy.taskId || '') === resolved ? legacy : null;
  }
  const policies = readSessionPolicies(config, alias);
  return policies.length === 1 ? policies[0] : null;
}

async function captureBaselineState(workspaceRoot) {
  if (!workspaceRoot) return { ok: false, files: [], error: 'workspace root is missing' };
  try {
    // Keep the branch record first so process-output normalization cannot strip
    // the leading status column from records such as " M file.js".
    const result = await runProcess('git', gitStatusArgs(), {
      cwd: workspaceRoot,
      timeout: 15000,
      maxOutputBytes: 8 * 1024 * 1024
    });
    if (result.exitCode !== 0 || result.stdoutTruncated) {
      return { ok: false, files: [], error: String(result.error || result.stderr || result.stdout || `git status exited ${result.exitCode}`).trim() };
    }
    const files = parseGitStatus(result.stdout || '').entries.map((entry) => entry.path);
    return { ok: true, files, error: '' };
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] baseline dirty capture:', error);
    return { ok: false, files: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function captureBaselineDirty(workspaceRoot) {
  return (await captureBaselineState(workspaceRoot)).files;
}

async function writeSessionPolicy(config, alias, { taskHint, workspaceRoot, taskId } = {}) {
  const resolved = String(taskId || '').trim();
  const filePath = resolved
    ? taskSessionFilePath(config, alias, resolved)
    : legacySessionFilePath(config, alias);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const baseline = await captureBaselineState(workspaceRoot);
  const now = new Date().toISOString();
  const data = {
    workspace: alias,
    createdAt: now,
    updatedAt: now,
    baselineCaptured: baseline.ok,
    baselineDirty: baseline.files,
    ...(baseline.error ? { baselineCaptureError: baseline.error } : {}),
    ...(resolved ? { taskId: resolved } : {}),
    ...(taskHint ? { taskHint } : {}),
  };
  persistPolicy(filePath, data);
  cachePolicy(filePath, data);
}

function touchSessionPolicy(config, alias, taskId = '') {
  const resolved = resolvedTaskId(taskId);
  const candidates = resolved
    ? [taskSessionFilePath(config, alias, resolved), legacySessionFilePath(config, alias)]
    : [legacySessionFilePath(config, alias)];
  for (const filePath of candidates) {
    try {
      const parsed = readPolicyFile(filePath, alias, resolved);
      if (!parsed) continue;
      const now = Date.now();
      parsed.updatedAt = new Date(now).toISOString();
      const cached = policyCache.get(filePath);
      const lastPersistedAt = cached?.lastPersistedAt || 0;
      cachePolicy(filePath, parsed, lastPersistedAt, cached?.fileRevision || policyFileRevision(filePath));
      if (now - lastPersistedAt >= SESSION_TOUCH_PERSIST_INTERVAL_MS) {
        persistPolicy(filePath, parsed);
        cachePolicy(filePath, parsed, now);
      }
      return true;
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session policy touch:', error);
    }
  }
  return false;
}

function persistPolicy(filePath, policy) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
}

async function ensureSessionStarted(config, alias, workspaceRoot, options = {}) {
  if (!alias) return false;
  const taskId = String(options.taskId || currentTaskId() || '').trim();
  const existing = readSessionPolicy(config, alias, taskId);
  if (existing) {
    touchSessionPolicy(config, alias, taskId);
    return false;
  }
  await writeSessionPolicy(config, alias, { workspaceRoot, taskId, taskHint: options.taskHint });
  return true;
}

function clearSessionPolicy(config, alias, taskId = '') {
  const resolved = resolvedTaskId(taskId);
  const candidates = resolved
    ? [taskSessionFilePath(config, alias, resolved), legacySessionFilePath(config, alias)]
    : [legacySessionFilePath(config, alias)];
  let cleared = false;
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      if (resolved && filePath === legacySessionFilePath(config, alias)) {
        const parsed = readPolicyFile(filePath, alias);
        if (!parsed || String(parsed.taskId || '') !== resolved) continue;
      }
      fs.unlinkSync(filePath);
      policyCache.delete(filePath);
      cleared = true;
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session policy clear:', error);
    }
  }
  return { cleared };
}

function resolvePolicy(workspace, config) {
  const alias = workspace?.taskSandbox === true && workspace?.sourceAlias
    ? workspace.sourceAlias
    : (workspace?.alias ?? String(workspace || ''));
  const taskId = currentTaskId();
  const session = readSessionPolicy(config, alias, taskId);
  if (session) {
    return {
      trusted: session.baselineCaptured === true,
      sessionActive: true,
      sessionCreatedAt: session.createdAt || null,
      taskId: session.taskId || null,
      taskHint: session.taskHint || null,
      baselineDirty: Array.isArray(session.baselineDirty) ? session.baselineDirty : [],
      baselineCaptured: session.baselineCaptured === true,
      baselineCaptureError: session.baselineCaptureError || null,
      source: session.taskId ? 'task_session_file' : 'legacy_session_file'
    };
  }
  const activePolicies = taskId ? [] : readSessionPolicies(config, alias);
  return {
    trusted: activePolicies.length <= 1,
    sessionActive: false,
    sessionCreatedAt: null,
    taskId: taskId || null,
    taskHint: null,
    baselineDirty: [],
    baselineCaptured: false,
    baselineCaptureError: null,
    ambiguous: activePolicies.length > 1,
    activeTaskCount: activePolicies.length,
    source: activePolicies.length > 1 ? 'multiple_task_sessions' : 'default'
  };
}

export { resolvePolicy, writeSessionPolicy, touchSessionPolicy, ensureSessionStarted, clearSessionPolicy, readSessionPolicy, captureBaselineDirty, SESSION_IDLE_TTL_MS, SESSION_TOUCH_PERSIST_INTERVAL_MS };
