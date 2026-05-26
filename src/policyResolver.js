const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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

function writeSessionPolicy(config, alias, { taskHint } = {}) {
  const filePath = sessionFilePath(config, alias);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const data = {
    workspace: alias,
    createdAt: new Date().toISOString(),
    ...(taskHint ? { taskHint } : {})
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
      source: 'session_file'
    };
  }
  return {
    trusted: true,
    sessionActive: false,
    sessionCreatedAt: null,
    taskHint: null,
    source: 'default'
  };
}

module.exports = { resolvePolicy, writeSessionPolicy, clearSessionPolicy, readSessionPolicy };
