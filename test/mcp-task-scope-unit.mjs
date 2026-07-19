import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveTaskScopeId, streamableSessionId } = require('../src/http/mcp.js');

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
const generatedSession = streamableSessionId({ headers: {} }, initialize);
assert.match(generatedSession, /^[0-9a-f-]{36}$/i);
assert.equal(streamableSessionId({ headers: { 'mcp-session-id': 'session-a' } }, initialize), 'session-a');
assert.equal(streamableSessionId({ headers: {} }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }), '');

const requestA = { headers: { 'mcp-session-id': 'session-a', authorization: 'Bearer shared-token' } };
const requestB = { headers: { 'mcp-session-id': 'session-b', authorization: 'Bearer shared-token' } };
const payload = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'relai_status', arguments: {} } };
assert.equal(resolveTaskScopeId(requestA, payload), resolveTaskScopeId(requestA, payload));
assert.notEqual(resolveTaskScopeId(requestA, payload), resolveTaskScopeId(requestB, payload));
assert.match(resolveTaskScopeId(requestA, payload), /^mcp:transport:[a-f0-9]{24}$/);
assert.notEqual(
  resolveTaskScopeId({ headers: { 'x-openai-conversation-id': 'conversation-a' } }, payload),
  resolveTaskScopeId({ headers: { 'x-openai-conversation-id': 'conversation-b' } }, payload)
);
const rotatedTransportA = {
  headers: {
    'mcp-session-id': 'transport-a',
    'x-openai-conversation-id': 'conversation-shared'
  }
};
const rotatedTransportB = {
  headers: {
    'mcp-session-id': 'transport-b',
    'x-openai-conversation-id': 'conversation-shared'
  }
};
assert.equal(
  resolveTaskScopeId(rotatedTransportA, payload, 'transport-a'),
  resolveTaskScopeId(rotatedTransportB, payload, 'transport-b'),
  'conversation identity must survive MCP transport session rotation'
);
assert.match(
  resolveTaskScopeId({ headers: { 'x-openai-conversation-id': 'conversation-a' } }, payload),
  /^mcp:conversation:[a-f0-9]{24}$/
);

const sameBearerDifferentSocketsA = { headers: { authorization: 'Bearer shared-token' }, socket: { remoteAddress: '127.0.0.1', remotePort: 41001 } };
const sameBearerDifferentSocketsB = { headers: { authorization: 'Bearer shared-token' }, socket: { remoteAddress: '127.0.0.1', remotePort: 41002 } };
const workspacePayloadA = { ...payload, params: { ...payload.params, arguments: { workspace: 'repo-a' } } };
const workspacePayloadB = { ...payload, params: { ...payload.params, arguments: { workspace: 'repo-b' } } };
assert.equal(
  resolveTaskScopeId(sameBearerDifferentSocketsA, workspacePayloadA),
  resolveTaskScopeId(sameBearerDifferentSocketsB, workspacePayloadA),
  'socket reconnects without conversation metadata must remain grouped for the same workspace'
);
assert.match(
  resolveTaskScopeId({ headers: {} }, workspacePayloadA),
  /^mcp:fallback:[a-f0-9]{24}$/
);
assert.notEqual(
  resolveTaskScopeId(sameBearerDifferentSocketsA, workspacePayloadA),
  resolveTaskScopeId(sameBearerDifferentSocketsA, workspacePayloadB),
  'workspace identity must keep fallback scopes from merging unrelated repositories'
);
assert.equal(
  resolveTaskScopeId({ headers: {} }, { ...payload, params: { ...payload.params, _meta: { conversationId: 'meta-conversation' } } }),
  resolveTaskScopeId({ headers: {} }, { ...payload, params: { ...payload.params, _meta: { conversationId: 'meta-conversation' } } })
);

console.log('MCP task scope and Streamable HTTP session tests passed.');
