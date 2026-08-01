import assert from 'node:assert/strict';

import { getMcpAccess } from "../src/http/mcp.js";
import * as serverExports from "../src/server.js";
import * as toolExports from "../src/tools.js";
import { connectorInstructions } from "../src/mcpServer.js";

assert.deepEqual(getMcpAccess('/mcp'), { kind: 'streamable-http' });
assert.deepEqual(getMcpAccess('/sse'), { kind: 'none' });
assert.deepEqual(getMcpAccess('/messages'), { kind: 'none' });
assert.equal(Object.hasOwn(serverExports, 'handleMessage'), false, 'the custom JSON-RPC dispatcher must be removed');
for (const name of ['workspaceList', 'workspaceInspect', 'workspaceTree', 'workspaceProfile']) {
  assert.equal(Object.hasOwn(toolExports, name), false, `${name} must not remain a public tools.js export`);
}
const instructions = connectorInstructions({ workspaces: { repo: { path: '/repo' } } });
assert.match(instructions, /relai_start_task exactly once/);
assert.match(instructions, /Pass task_id to every later task-scoped Rel\.AI call/);
assert.match(instructions, /omit workspace unless you want Rel\.AI to verify an ownership assertion/);
assert.match(instructions, /MCP 2026-07-28 is stateless/);
assert.match(instructions, /no transport identifier is a task identity/);

console.log('MCP SDK boundary exposes only /mcp and uses explicit task_id identity.');
