import assert from 'node:assert/strict';

import { startHttpServer } from '../src/httpServer.js';

const server = startHttpServer({
  host: '127.0.0.1',
  port: 0,
  allowNoAuth: true,
  writeProfile: false,
  getRuntimeAccess: () => ({
    blocked: true,
    errorCode: 'update_required',
    message: 'Rel.AI MCP must be updated before MCP work can continue.'
  })
});

try {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address();
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200, 'dashboard/service health must remain available during an update block');
  const mcp = await fetch(`http://127.0.0.1:${port}/mcp`);
  assert.equal(mcp.status, 426, 'MCP transport must be blocked when the runtime support policy requires an update');
  const payload = await mcp.json();
  assert.equal(payload.errorCode, 'update_required');
} finally {
  await new Promise(resolve => server.close(resolve));
  await server.waitForShutdown?.();
}

console.log('Remote update support policy HTTP gate passed.');
