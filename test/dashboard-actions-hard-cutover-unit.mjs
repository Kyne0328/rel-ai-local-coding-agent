import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-actions-cutover-'));
const workspace = path.join(temp, 'workspace');
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, 'index.js'), 'export const ready = true;\n');
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
  name: 'dashboard-validation-fixture',
  version: '1.0.0',
  type: 'module',
  scripts: { test: 'node --check index.js' }
}, null, 2));
fs.writeFileSync(configPath, JSON.stringify({
  version: 3,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: {
    repo: {
      path: workspace,
      commands: {},
      testCommands: { test: 'node --check index.js' }
    }
  }
}, null, 2));

const previousConfig = process.env.REL_AI_MCP_CONFIG;
const previousState = process.env.REL_AI_MCP_STATE_DIR;
process.env.REL_AI_MCP_CONFIG = configPath;
process.env.REL_AI_MCP_STATE_DIR = stateDir;

try {
  const { handleWorkspaceChecks } = await import('../src/http/dashboardActions.js');
  const req = Readable.from([Buffer.from(JSON.stringify({ workspace: 'repo' }))]);
  req.headers = { 'content-type': 'application/json' };
  const response = responseRecorder();
  await handleWorkspaceChecks({
    req,
    res: response.res,
    ae: '',
    options: { maxBodyBytes: 1024 * 1024 }
  });
  const result = response.json();
  assert.equal(response.status(), 200);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.completionKnown, true);
  assert.equal(result.validationStatus, 'passed');
  assert.match(result.work_id || '', /^[0-9a-f-]{36}$/i);
  assert.match(result.summary || '', /Dashboard validation completed for repo/);

  const source = fs.readFileSync(new URL('../src/http/dashboardActions.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /callTool\('relai_run_checks'/);
  assert.match(source, /callTool\('relai_work'/);
  assert.match(source, /callTool\('relai_validate'/);
  console.log('Dashboard validation uses the consolidated begin and validate actions after the hard cutover.');
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  if (previousState == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousState;
  fs.rmSync(temp, { recursive: true, force: true });
}

function responseRecorder() {
  let statusCode = 0;
  let body = Buffer.alloc(0);
  const headers = new Map();
  const res = {
    headersSent: false,
    destroyed: false,
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    writeHead(status, values = {}) {
      statusCode = status;
      this.headersSent = true;
      for (const [name, value] of Object.entries(values)) headers.set(name.toLowerCase(), value);
    },
    end(value = Buffer.alloc(0)) { body = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); }
  };
  return {
    res,
    status: () => statusCode,
    json: () => JSON.parse(body.toString('utf8'))
  };
}
