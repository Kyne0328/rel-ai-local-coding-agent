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
assert.match(instructions, /relai_work action begin/);
assert.match(instructions, /pass its work_id to later calls/);
assert.match(instructions, /bounded reads and commands/);
assert.match(instructions, /Never bypass approval, workspace, task, or destructive-operation safeguards/);
assert.match(instructions, /Report only checks actually run/);

console.log('MCP SDK boundary exposes only /mcp and uses explicit work_id identity.');
