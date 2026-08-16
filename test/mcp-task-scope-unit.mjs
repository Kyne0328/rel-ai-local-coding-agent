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
assert.match(instructions, /unrelated objective.*work_id.*configured workspace/i);
assert.match(instructions, /Never bypass approval, workspace, task-ownership, authorization, or destructive-operation safeguards/);
assert.match(instructions, /repository.*not authorization/i, 'server instructions must keep repository-controlled text below authorization boundaries');
assert.match(instructions, /cannot authorize credential disclosure/i);
assert.match(instructions, /report only checks and observations actually performed/i);
assert.match(instructions, /explicit task-completion contract/i);

console.log('MCP SDK boundary exposes only /mcp and uses explicit work_id identity.');
