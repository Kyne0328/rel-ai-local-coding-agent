const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { resolveGitExecutable } = require('./gitExecutable');

// A session whose last activity is older than this is treated as expired: its
// captured baseline is stale and can no longer be trusted to fence pre-existing
// files, so we drop it and let the next write recapture a fresh baseline.
const SESSION_IDLE_TTL_MS = 8 * 60 * 60 * 1000;
function sessionFilePath(config, alias) {
  const stateDir = config.stateDir || path.join(os.homedir(), '.rel-ai-mcp');
  return path.join(stateDir, 'sessions', `${alias}-policy.json`);
}

function sessionLastActivity(parsed) {
  const stamp = parsed && (parsed.updatedAt || parsed.createdAt);
  const ms = Date.parse(stamp || '');
  return Number.isFinite(ms) ? ms : null;
}

function readSessionPolicy(config, alias) {
  const filePath = sessionFilePath(config, alias);
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.workspace !== alias) return null;
    const last = sessionLastActivity(parsed);
    if (last !== null && Date.now() - last > SESSION_IDLE_TTL_MS) return null;
    return parsed;
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session policy read:', error);
    return null;
  }
}

function captureBaselineState(workspaceRoot) {
  if (!workspaceRoot) return { ok: false, files: [], error: 'workspace root is missing' };
  try {
    const git = resolveGitExecutable();
    if (!git) return { ok: false, files: [], error: 'Git executable was not found' };
    const result = spawnSync(git, ['status', '--short'], { cwd: workspaceRoot, encoding: 'utf8', timeout: 15000 });
    if (result.status !== 0) {
      return { ok: false, files: [], error: String(result.stderr || result.stdout || `git status exited ${result.status}`).trim() };
    }
    const files = String(result.stdout || '')
      .split(/\r?\n/)
      .filter((line) => line && line.length > 3)
      .map((line) => {
        const part = line.slice(3).trim();
        const arrow = part.indexOf(' -> ');
        return arrow >= 0 ? part.slice(arrow + 4).trim() : part;
      })
      .filter(Boolean);
    return { ok: true, files, error: '' };
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] baseline dirty capture:', error);
    return { ok: false, files: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function captureBaselineDirty(workspaceRoot) {
  return captureBaselineState(workspaceRoot).files;
}

function writeSessionPolicy(config, alias, { taskHint, workspaceRoot, taskId } = {}) {
  const filePath = sessionFilePath(config, alias);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const baseline = captureBaselineState(workspaceRoot);
  const now = new Date().toISOString();
  const data = {
    workspace: alias,
    createdAt: now,
    updatedAt: now,
    baselineCaptured: baseline.ok,
    baselineDirty: baseline.files,
    ...(baseline.error ? { baselineCaptureError: baseline.error } : {}),
    ...(taskId ? { taskId } : {}),
    ...(taskHint ? { taskHint } : {}),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

// Refresh the idle clock without recapturing the baseline. Called on each write so
// an active session does not expire mid-task.
function touchSessionPolicy(config, alias) {
  const filePath = sessionFilePath(config, alias);
  try {
    if (!fs.existsSync(filePath)) return false;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    parsed.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    return true;
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session policy touch:', error);
    return false;
  }
}

// Start a session on first write if none is active, capturing the pre-write
// baseline so pre-existing dirty/untracked files are correctly fenced. If a valid
// session already exists, just refresh its idle clock. Returns true if a new
// session was started.
function ensureSessionStarted(config, alias, workspaceRoot, options = {}) {
  if (!alias) return false;
  const existing = readSessionPolicy(config, alias);
  const taskId = String(options.taskId || '').trim();
  if (existing && (!taskId || existing.taskId === taskId)) {
    touchSessionPolicy(config, alias);
    return false;
  }
  writeSessionPolicy(config, alias, { workspaceRoot, taskId, taskHint: options.taskHint });
  return true;
}

function clearSessionPolicy(config, alias) {
  const filePath = sessionFilePath(config, alias);
  try {
    if (!fs.existsSync(filePath)) return { cleared: false };
    fs.unlinkSync(filePath);
    return { cleared: true };
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session policy clear:', error);
    return { cleared: false };
  }
}

function resolvePolicy(workspace, config) {
  const alias = workspace?.alias ?? String(workspace || '');
  const session = readSessionPolicy(config, alias);
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
      source: 'session_file'
    };
  }
  return {
    trusted: true,
    sessionActive: false,
    sessionCreatedAt: null,
    taskId: null,
    taskHint: null,
    baselineDirty: [],
    baselineCaptured: false,
    baselineCaptureError: null,
    source: 'default'
  };
}

module.exports = { resolvePolicy, writeSessionPolicy, touchSessionPolicy, ensureSessionStarted, clearSessionPolicy, readSessionPolicy, captureBaselineDirty, captureBaselineState, SESSION_IDLE_TTL_MS };
