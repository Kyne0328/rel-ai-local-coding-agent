import assert from 'node:assert/strict';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY
} from '@modelcontextprotocol/server';
import {
  MCP_PROTOCOL_VERSION,
  expectedMcpName,
  validateMcpRequestHeaders
} from '../src/http/mcpTransport.js';

function message(method = 'server/discover', params = {}) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: MCP_PROTOCOL_VERSION,
        [CLIENT_INFO_META_KEY]: { name: 'header-unit', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: {},
        ...(params._meta || {})
      }
    }
  };
}

function headers(method = 'server/discover', name = '') {
  return {
    'mcp-protocol-version': MCP_PROTOCOL_VERSION,
    'mcp-method': method,
    ...(name ? { 'mcp-name': name } : {})
  };
}

assert.deepEqual(validateMcpRequestHeaders(headers(), message()), { ok: true });
assert.deepEqual(validateMcpRequestHeaders(headers(), {
  jsonrpc: '2.0', id: 1, method: 'server/discover', params: {
    _meta: {
      [PROTOCOL_VERSION_META_KEY]: MCP_PROTOCOL_VERSION,
      [CLIENT_CAPABILITIES_META_KEY]: {}
    }
  }
}), { ok: true }, 'clientInfo is optional in MCP 2026-07-28');
assert.equal(validateMcpRequestHeaders({}, message()).code, -32022);
assert.deepEqual(
  validateMcpRequestHeaders({
    'mcp-protocol-version': '2025-11-25',
    'mcp-method': 'server/discover'
  }, message()).data,
  { supported: [MCP_PROTOCOL_VERSION], requested: '2025-11-25' }
);
assert.equal(
  validateMcpRequestHeaders(headers('tools/list'), message('server/discover')).code,
  -32020
);
assert.equal(
  validateMcpRequestHeaders(headers('server/discover'), {
    jsonrpc: '2.0', id: 1, method: 'server/discover', params: {}
  }).code,
  -32602
);
assert.equal(
  validateMcpRequestHeaders(headers(), message('server/discover', {
    _meta: { [PROTOCOL_VERSION_META_KEY]: '2025-11-25' }
  })).code,
  -32020
);
assert.equal(
  validateMcpRequestHeaders(headers(), message('server/discover', {
    _meta: { [CLIENT_INFO_META_KEY]: { name: '', version: '' } }
  })).code,
  -32602
);
assert.equal(
  validateMcpRequestHeaders(headers(), message('server/discover', {
    _meta: { [CLIENT_CAPABILITIES_META_KEY]: [] }
  })).code,
  -32602
);
assert.equal(
  validateMcpRequestHeaders(headers('tools/call'), message('tools/call', {
    name: 'relai_status', arguments: {}
  })).code,
  -32020
);
assert.equal(
  validateMcpRequestHeaders(
    headers('tools/call', 'wrong-name'),
    message('tools/call', { name: 'relai_status', arguments: {} })
  ).code,
  -32020
);
assert.equal(
  validateMcpRequestHeaders({
    ...headers('tasks/get', 'task_wrong'),
    'mcp-session-id': 'legacy-session'
  }, message('tasks/get', { taskId: 'task_wrong' })).code,
  -32600
);
assert.equal(
  validateMcpRequestHeaders({
    ...headers('tools/list'),
    'mcp-param-extra': 'undeclared'
  }, message('tools/list')).code,
  -32020
);
assert.equal(
  validateMcpRequestHeaders({
    'mcp-protocol-version': '2025-11-25',
    'mcp-method': 'initialize'
  }, message('initialize')).code,
  -32601
);
assert.equal(validateMcpRequestHeaders(headers(), []).code, -32600);
assert.equal(expectedMcpName('tools/call', { name: 'relai_status' }), 'relai_status');
assert.equal(expectedMcpName('resources/read', { uri: 'relai://server/help' }), 'relai://server/help');
assert.equal(expectedMcpName('tasks/get', { taskId: 'task_abc' }), 'task_abc');

console.log('Strict MCP 2026-07-28 protocol headers, metadata, names, and session rejection matrix passed.');
