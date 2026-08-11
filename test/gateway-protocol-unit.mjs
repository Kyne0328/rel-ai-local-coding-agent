import assert from 'node:assert/strict';
import {
  GATEWAY_PROTOCOL_VERSION,
  MINIMUM_GATEWAY_PROTOCOL_VERSION,
  MAX_GATEWAY_MESSAGE_BYTES,
  GATEWAY_ERROR_CODES,
  validateGatewayFrame,
  validateRoutedRequest,
  classifyMcpRequest,
  gatewayCompatibility
} from '../src/gateway/protocol.js';

assert.equal(GATEWAY_PROTOCOL_VERSION, 1);
assert.equal(MINIMUM_GATEWAY_PROTOCOL_VERSION, 1);
assert.equal(MAX_GATEWAY_MESSAGE_BYTES, 10 * 1024 * 1024);
assert.equal(GATEWAY_ERROR_CODES.DEVICE_OFFLINE, 'DEVICE_OFFLINE');
assert.equal(GATEWAY_ERROR_CODES.RESULT_UNAVAILABLE, 'RESULT_UNAVAILABLE');

assert.equal(validateGatewayFrame({ type: 'heartbeat' }).ok, true);
assert.equal(validateGatewayFrame({ type: 'devices_request', requestId: 'd1' }).ok, true);
assert.equal(validateGatewayFrame({ type: 'devices_result', requestId: 'd1', devices: [{ deviceId: 'dev', displayName: 'Desktop' }] }).ok, true);
assert.equal(validateGatewayFrame({ type: 'devices_result', requestId: 'd1', devices: [{ deviceId: 'dev', publicJwk: {} }] }).ok, false);
assert.equal(validateGatewayFrame({ type: 'device_revoke', requestId: 'r1', deviceId: 'dev' }).ok, true);
assert.equal(validateGatewayFrame({ type: 'device_revoke_result', requestId: 'r1', deviceId: 'dev', ok: true }).ok, true);

assert.equal(validateGatewayFrame({ type: 'unknown' }).ok, false);
assert.equal(validateGatewayFrame({ type: 'authenticate', principalId: 'p', deviceId: 'd', signature: 's', extra: true }).ok, false);
assert.equal(validateGatewayFrame({ type: 'result', gatewayRequestId: 'r', ok: true, payload: {}, extra: true }).ok, false);

assert.equal(validateRoutedRequest({
  gatewayRequestId: 'req_1',
  requestKey: 'key_1',
  message: { jsonrpc: '2.0', id: 1, method: 'resources/read', params: {} }
}).ok, true);
assert.equal(validateRoutedRequest({ gatewayRequestId: '', requestKey: 'key_1', message: {} }).ok, false);

assert.equal(classifyMcpRequest({ method: 'resources/read' }, {}).idempotency, 'read_only');
assert.equal(classifyMcpRequest({ method: 'tools/list' }, {}).idempotency, 'read_only');
assert.equal(classifyMcpRequest({ method: 'tasks/get' }, {}).idempotency, 'read_only');
assert.equal(classifyMcpRequest({ method: 'tasks/update' }, {}).idempotency, 'mutating');
assert.equal(classifyMcpRequest({ method: 'tasks/cancel' }, {}).idempotency, 'mutating');
assert.equal(classifyMcpRequest({ method: 'tools/call', params: { name: 'write_tool' } }, {
  tools: [{ name: 'write_tool', annotations: { readOnlyHint: false, idempotentHint: false } }]
}).idempotency, 'mutating');
assert.equal(classifyMcpRequest({ method: 'tools/call', params: { name: 'read_tool' } }, {
  tools: [{ name: 'read_tool', annotations: { readOnlyHint: true, idempotentHint: true } }]
}).idempotency, 'read_only');
assert.equal(classifyMcpRequest({ method: 'tools/call', params: { name: 'missing_tool' } }, { tools: [] }).ok, false);

assert.equal(gatewayCompatibility({ protocolVersion: 0 }).ok, false);
assert.equal(gatewayCompatibility({ protocolVersion: 1 }).ok, true);
assert.equal(gatewayCompatibility({ protocolVersion: 2 }).ok, false);

console.log('Gateway protocol validation and request classification tests passed.');
