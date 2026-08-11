import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY
} from '@modelcontextprotocol/server';
import { createGatewayLocalExecutor } from '../src/gateway/localExecution.js';
import { createNativeTask, getNativeTask } from '../src/mcp/nativeTaskService.js';
import { MCP_PROTOCOL_VERSION, TASKS_EXTENSION_ID, TASKS_EXTENSION_REVISION } from '../src/mcp/protocol.js';
import { readConfig } from '../src/config.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-gateway-local-exec-'));
const repo = path.join(root, 'repo');
const stateDir = path.join(root, 'state');
const configPath = path.join(root, 'config.json');
fs.mkdirSync(repo, { recursive: true });
fs.writeFileSync(path.join(repo, 'README.md'), 'base\n', 'utf8');
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Rel.AI Gateway Test'], { cwd: repo });
execFileSync('git', ['add', 'README.md'], { cwd: repo });
execFileSync('git', ['commit', '-m', 'base'], { cwd: repo, stdio: 'ignore' });
fs.writeFileSync(configPath, `${JSON.stringify({
  version: 3,
  stateDir,
  workspaces: {
    repo: {
      path: repo,
      testCommands: {},
      commands: {},
      protectedBranches: ['main', 'master'],
      defaultBaseBranch: 'main',
      allowedRemotes: ['origin']
    }
  }
}, null, 2)}\n`, 'utf8');

const priorConfig = process.env.REL_AI_MCP_CONFIG;
process.env.REL_AI_MCP_CONFIG = configPath;
const principalA = 'prn_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const principalB = 'prn_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const gatewayOrigin = 'https://gateway.test';

function meta(capabilities = {}) {
  return {
    [PROTOCOL_VERSION_META_KEY]: MCP_PROTOCOL_VERSION,
    [CLIENT_INFO_META_KEY]: { name: 'gateway-local-execution-test', version: '1.0.0' },
    [CLIENT_CAPABILITIES_META_KEY]: capabilities
  };
}

function toolMessage(id, name, args, extra = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args, _meta: meta(), ...extra }
  };
}

function taskMessage(id, method, taskId) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      taskId,
      _meta: meta({ extensions: { [TASKS_EXTENSION_ID]: { revision: TASKS_EXTENSION_REVISION } } })
    }
  };
}

function routed(executor, message, options = {}) {
  return executor({
    principalId: options.principalId || principalA,
    gatewayRequestId: `gw_${message.id}`,
    requestKey: `rk_${message.id}`,
    message,
    workspace: options.workspace ?? String(message.params?.arguments?.workspace || ''),
    deadlineAt: Date.now() + 30_000,
    signal: options.signal
  });
}

function payload(outcome) {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.payload?.jsonrpc, '2.0');
  return outcome.payload;
}

try {
  const config = readConfig();
  const executeA = createGatewayLocalExecutor({ gatewayOrigin, pairedPrincipalId: principalA, config });
  const executeB = createGatewayLocalExecutor({ gatewayOrigin, pairedPrincipalId: principalB, config });

  const mismatch = await routed(executeA, toolMessage(1, 'relai_status', {}), { principalId: principalB, workspace: '' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.code, 'GATEWAY_PRINCIPAL_MISMATCH');

  const begin = payload(await routed(executeA, toolMessage(2, 'relai_work', {
    action: 'begin', workspace: 'repo', title: 'Gateway isolation', objective: 'Verify gateway principal isolation.', bootstrap: 'none'
  }), { workspace: 'repo' }));
  assert.equal(begin.error, undefined);
  assert.equal(begin.result?.isError, false, JSON.stringify(begin.result));
  const workId = String(begin.result?.structuredContent?.work_id || begin.result?.structuredContent?.workId || '');
  assert.ok(workId, JSON.stringify(begin.result));

  const readA = payload(await routed(executeA, toolMessage(3, 'relai_read', {
    workspace: 'repo', work_id: workId, paths: ['README.md'], guidanceMode: 'none'
  }), { workspace: 'repo' }));
  assert.equal(readA.result?.isError, false);
  assert.match(JSON.stringify(readA.result), /base/);
  assert.equal(readA.result?.structuredContent?.ok, true, 'cloud-routed call must use connector/publicHttpOnly serialization');

  const denied = payload(await routed(executeB, toolMessage(4, 'relai_read', {
    workspace: 'repo', work_id: workId, paths: ['README.md'], guidanceMode: 'none'
  }), { workspace: 'repo', principalId: principalB }));
  assert.equal(denied.result?.isError, true);
  assert.match(JSON.stringify(denied.result), /task|principal|client|available/i);

  const absolute = await routed(executeA, toolMessage(5, 'relai_status', { workspace: repo }), { workspace: repo });
  assert.equal(absolute.ok, false);
  assert.equal(absolute.error.code, 'WORKSPACE_NOT_AVAILABLE');

  const mismatchedWorkspace = await routed(executeA, toolMessage(6, 'relai_read', {
    workspace: 'repo', work_id: workId, paths: ['README.md']
  }), { workspace: 'other' });
  assert.equal(mismatchedWorkspace.ok, false);
  assert.equal(mismatchedWorkspace.error.code, 'WORKSPACE_NOT_AVAILABLE');

  const resources = payload(await routed(executeA, {
    jsonrpc: '2.0', id: 7, method: 'resources/list', params: { _meta: meta() }
  }, { workspace: '' }));
  assert.ok(resources.result.resources.some(item => item.uri === 'relai://server/help'));
  assert.ok(resources.result.resources.some(item => item.uri === 'relai://workspace/repo/tree'));

  const resource = payload(await routed(executeA, {
    jsonrpc: '2.0', id: 8, method: 'resources/read', params: { uri: 'relai://workspace/repo/tree', _meta: meta() }
  }, { workspace: '' }));
  assert.equal(resource.result.contents[0].uri, 'relai://workspace/repo/tree');

  const pathResource = await routed(executeA, {
    jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: `relai://workspace/${encodeURIComponent(repo)}/tree`, _meta: meta() }
  }, { workspace: '' });
  assert.equal(pathResource.ok, false);
  assert.equal(pathResource.error.code, 'WORKSPACE_NOT_AVAILABLE');

  const taskController = new AbortController();
  const native = createNativeTask(config, {
    principal: executeA.principal,
    method: 'tools/call',
    name: 'gateway-native-test',
    executor: { controller: taskController }
  });
  const taskGet = payload(await routed(executeA, taskMessage(10, 'tasks/get', native.taskId), { workspace: '' }));
  assert.equal(taskGet.result.taskId, native.taskId);
  const taskDenied = payload(await routed(executeB, taskMessage(11, 'tasks/get', native.taskId), { workspace: '', principalId: principalB }));
  assert.equal(taskDenied.error?.code, -32602);
  const taskCancel = payload(await routed(executeA, taskMessage(12, 'tasks/cancel', native.taskId), { workspace: '' }));
  assert.equal(taskCancel.error, undefined);
  assert.equal(taskController.signal.aborted, true);
  assert.equal(getNativeTask(config, native.taskId, { principal: executeA.principal }).status, 'working');

  fs.writeFileSync(path.join(repo, 'README.md'), 'changed\n', 'utf8');
  const resetArgs = { action: 'reset', workspace: 'repo', work_id: workId, confirmation: 'RESET' };
  const approval = payload(await routed(executeA, toolMessage(13, 'relai_changes', resetArgs), { workspace: 'repo' }));
  assert.equal(approval.result?.resultType, 'input_required');
  assert.equal(typeof approval.result?.requestState, 'string');
  assert.ok(approval.result?.inputRequests?.approval);
  assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), 'changed\n');

  const approved = payload(await routed(executeA, toolMessage(14, 'relai_changes', resetArgs, {
    requestState: approval.result.requestState,
    inputResponses: { approval: { action: 'accept', content: { approved: true } } }
  }), { workspace: 'repo' }));
  assert.equal(approved.result?.isError, false, JSON.stringify(approved.result));
  assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8').replaceAll('\r\n', '\n'), 'base\n');

  const tampered = payload(await routed(executeA, toolMessage(15, 'relai_changes', resetArgs, {
    requestState: `${approval.result.requestState}tampered`,
    inputResponses: { approval: { action: 'accept', content: { approved: true } } }
  }), { workspace: 'repo' }));
  assert.equal(tampered.error?.code, -32602);

  const unsupported = await routed(executeA, { jsonrpc: '2.0', id: 16, method: 'tools/list', params: { _meta: meta() } }, { workspace: '' });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, 'DEVICE_RESPONSE_INVALID');

  console.log('Gateway local execution, principal isolation, resources, native tasks, approval retries, and alias-only routing passed.');
} finally {
  if (priorConfig === undefined) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = priorConfig;
  fs.rmSync(root, { recursive: true, force: true });
}
