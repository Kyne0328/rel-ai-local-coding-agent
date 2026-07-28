import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

import { relaiHttpProbe, relaiUiCheck } from "../src/bridge/browser.js";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-browser-contract-'));
const workspaceRoot = path.join(temp, 'repo');
const stateDir = path.join(temp, 'state');
fs.mkdirSync(workspaceRoot, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, 'package.json'), `${JSON.stringify({
  name: 'browser-contract-fixture',
  private: true,
  scripts: {
    'ui:pass': 'node -e "process.stdout.write(\'ui-ok\')"'
  }
}, null, 2)}\n`);

const server = http.createServer((request, response) => {
  if (request.url === '/ok') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Route OK</title><p>ready</p>');
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('missing');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not expose a TCP port');
fs.writeFileSync(path.join(stateDir, 'connection.json'), `${JSON.stringify({ host: '127.0.0.1', port: address.port })}\n`);

const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
process.env.REL_AI_MCP_STATE_DIR = stateDir;
const workspace = { alias: 'repo', path: workspaceRoot };

try {
  const probe = await relaiHttpProbe(workspace, {}, { route: '/ok' });
  assert.equal(probe.ok, true);
  assert.equal(probe.mode, 'http-probe');
  assert.equal(probe.route, '/ok');
  assert.equal(probe.httpStatus, 200);
  assert.equal(probe.title, 'Route OK');
  assert.equal(probe.reachable, true);

  await assert.rejects(
    () => relaiHttpProbe(workspace, {}, { route: 'https://example.com/' }),
    /local path beginning with one '\/'/,
    'the dedicated HTTP probe must reject arbitrary URLs'
  );
  await assert.rejects(
    () => relaiHttpProbe(workspace, {}, { route: '//example.com/' }),
    /protocol-relative URLs are not accepted/,
    'the dedicated HTTP probe must reject protocol-relative URLs'
  );
  await assert.rejects(
    () => relaiHttpProbe(workspace, {}, { route: '/\\\\example.com/' }),
    /configured local Rel\.AI origin/,
    'backslash-normalized routes must not escape the local origin'
  );
  const uiCheck = await relaiUiCheck(workspace, {}, { check: 'ui:pass' });
  assert.equal(uiCheck.ok, true);
  assert.equal(uiCheck.mode, 'ui-check');
  assert.equal(uiCheck.check, 'ui:pass');
  assert.match(uiCheck.stdout, /ui-ok/);

  const unknown = await relaiUiCheck(workspace, {}, { check: 'missing' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /relai_ui_check runs named package\.json scripts only/);
  assert.deepEqual(unknown.availableChecks, ['ui:pass']);

  console.log('HTTP probing and named UI checks contract passed.');
} finally {
  if (previousStateDir == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  server.close();
  await once(server, 'close');
  fs.rmSync(temp, { recursive: true, force: true });
}
