import * as os from 'node:os';
import * as path from 'node:path';

function defaultStateDir() {
  return path.join(os.homedir(), '.rel-ai-mcp');
}

function getStateDir(config = {}) {
  return process.env.REL_AI_MCP_STATE_DIR || config.stateDir || defaultStateDir();
}

export { defaultStateDir, getStateDir };
