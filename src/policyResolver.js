const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function sessionFilePath(config, alias) {
  const stateDir = config.stateDir || path.join(os.homedir(), '.rel-ai-mcp');
  return path.join(stateDir, 'sessions', `${alias}-policy.json`);
}

function readSessionPolicy(config, alias) {
  const filePath = sessionFilePath(config, alias);
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

function captureBaselineDirty(workspaceRoot) {
  if (!workspaceRoot) return [];
  try {
    const result = spawnSync('git', ['status', '--short'], { cwd: workspaceRoot, encoding: 'utf8', timeout: 15000 });
    if (result.status !== 0 || !result.stdout) return [];
    return result.stdout
      .split(/\r?\n/)
      .filter((line) => line && line.length > 3)
      .map((line) => {
        const part = line.slice(3).trim();
        const arrow = part.indexOf(' -> ');
        return arrow >= 0 ? part.slice(arrow + 4).trim() : part;
      })
      .filter(Boolean);
  } catch (_err) {
    return [];
  }
}

function writeSessionPolicy(config, alias, { taskHint, workspaceRoot } = {}) {
  const filePath = sessionFilePath(config, alias);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const baselineDirty = captureBaselineDirty(workspaceRoot);
  const data = {
    workspace: alias,
    createdAt: new Date().toISOString(),
    ...(taskHint ? { taskHint } : {}),
    ...(baselineDirty.length ? { baselineDirty } : {})
  };
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function clearSessionPolicy(config, alias) {
  const filePath = sessionFilePath(config, alias);
  try {
    if (!fs.existsSync(filePath)) return { cleared: false };
    fs.unlinkSync(filePath);
    return { cleared: true };
  } catch (_err) {
    return { cleared: false };
  }
}

function resolvePolicy(workspace, config) {
  const alias = workspace && workspace.alias ? workspace.alias : String(workspace || '');
  const session = readSessionPolicy(config, alias);
  if (session) {
    return {
      trusted: true,
      sessionActive: true,
      sessionCreatedAt: session.createdAt || null,
      taskHint: session.taskHint || null,
      baselineDirty: Array.isArray(session.baselineDirty) ? session.baselineDirty : [],
      source: 'session_file'
    };
  }
  return {
    trusted: true,
    sessionActive: false,
    sessionCreatedAt: null,
    taskHint: null,
    baselineDirty: [],
    source: 'default'
  };
}

module.exports = { resolvePolicy, writeSessionPolicy, clearSessionPolicy, readSessionPolicy, captureBaselineDirty };
