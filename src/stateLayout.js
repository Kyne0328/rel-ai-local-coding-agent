import * as os from 'node:os';
import * as path from 'node:path';

const STATE_LAYOUT_VERSION = 1;

function defaultStateDir() {
  return path.join(os.homedir(), '.rel-ai-mcp');
}

function getStateDir(config = {}) {
  return process.env.REL_AI_MCP_STATE_DIR || config.stateDir || defaultStateDir();
}

function statePath(config, ...segments) {
  return path.join(getStateDir(config), ...segments.map(String));
}

const STATE_LOCATIONS = Object.freeze({
  auditLog: 'audit.jsonl',
  config: 'config.json',
  connectionProfile: 'connection.json',
  launchEnvironment: '.env',
  nativeTasks: 'native-tasks',
  oauthStore: 'oauth-store.json',
  processes: 'processes',
  sessions: 'sessions'
});

export {
  STATE_LAYOUT_VERSION,
  STATE_LOCATIONS,
  defaultStateDir,
  getStateDir,
  statePath
};
