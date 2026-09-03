import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_INFO_META_KEY } from '@modelcontextprotocol/server';
import { TASKS_EXTENSION_REVISION } from '../src/mcp/protocol.js';
import { repositoryIndexPath } from '../src/repository/intelligence/database.js';
import { readTaskHistorySessionRecord } from '../src/taskHistoryStore.js';
import { createHttpMcpSession, MCP_VERSION } from './helpers/http-mcp.mjs';
import { activeMcpToolCount, activeToolCount, activeToolNames, activeToolSurface } from './helpers/tool-surface.mjs';
import { localHttpFetch as fetch, startHttpTestServer, stopHttpTestServer } from './helpers/http-test-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = 'http-smoke-token';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-http-smoke-'));
const profile = path.join(stateDir, 'connection.json');
const originalProfile = `${JSON.stringify({ host: 'sentinel.invalid', port: 65535 }, null, 2)}\n`;
fs.writeFileSync(profile, originalProfile);
const configPath = path.join(stateDir, 'config.json');
const config = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'config.example.json'), 'utf8'));
config.stateDir = stateDir;
config.auditLogPath = path.join(stateDir, 'audit.jsonl');
config.workspaces = { repo: { ...(config.workspaces?.repo || {}), path: root } };
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
const { child, base } = await startHttpTestServer({
  root,
  configPath,
  token,
  stateDir,
  env: { REL_AI_MCP_MAX_BODY_BYTES: String(12 * 1024 * 1024) }
});

let client = null;
try {
  const health = await fetch(`${base}/health`).then(response => response.json());
  assert.equal(health.ok, true);
  assert.ok(health.transports.includes('streamable-http'));

  const dashboardLogin = await fetch(`${base}/dashboard?token=${encodeURIComponent(token)}`);
  assert.equal(dashboardLogin.status, 200);
  const dashboardCookie = String(dashboardLogin.headers.get('set-cookie') || '').split(';')[0];
  assert.match(dashboardCookie, /^relai_dashboard_session=/);
  await dashboardLogin.arrayBuffer();
  const dashboardHeaders = { cookie: dashboardCookie };

  const uncompressed = await fetch(`${base}/api/tools`, { headers: { ...dashboardHeaders, 'accept-encoding': 'gzip' } });
  assert.equal(uncompressed.headers.get('content-encoding'), null, 'Rel.AI JSON responses must stay uncompressed even when a local client advertises gzip');
  const uncompressedTools = await uncompressed.json();
  assert.equal(uncompressedTools.length, activeToolCount);

  const dashboard = await fetch(`${base}/api/dashboard/v10`, { headers: dashboardHeaders }).then(response => response.json());
  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.application.name, 'Rel.AI MCP');
  assert.ok(Array.isArray(dashboard.tasks));
  assert.equal(typeof dashboard.workspaceStates, 'object');

  client = await createHttpMcpSession(base, { token, clientName: 'relai-http-smoke' });
  const discovery = client.discovery;
  assert.equal(discovery.response.status, 200);
  assert.deepEqual(discovery.body.result?.supportedVersions, [MCP_VERSION]);
  assert.equal(discovery.body.result?.capabilities?.experimental?.relai?.toolSurfaceVersion, activeToolSurface.toolSurfaceVersion);
  assert.equal(discovery.body.result?.capabilities?.experimental?.relai?.toolCount, activeToolCount);
  assert.equal(Object.hasOwn(discovery.body.result?.capabilities?.experimental?.relai || {}, 'appToolCount'), false, 'native presentation must not advertise an app-only tool count');
  assert.equal(discovery.body.result?.capabilities?.experimental?.relai?.deploymentMode, 'local_developer');
  assert.equal(discovery.body.result?.capabilities?.experimental?.relai?.statelessRequestModel, true);
  assert.deepEqual(
    discovery.body.result?.capabilities?.extensions?.['io.modelcontextprotocol/tasks'],
    { revision: TASKS_EXTENSION_REVISION }
  );
  assert.equal(discovery.body.result?._meta?.[SERVER_INFO_META_KEY]?.name, 'rel-ai-mcp');
  assert.match(discovery.body.result?._meta?.[SERVER_INFO_META_KEY]?.version || '', /^0\./);
  const serverInstructions = discovery.body.result?.instructions || '';
  assert.match(serverInstructions, /task-ownership/i);
  assert.match(serverInstructions, /approval/i);
  assert.match(serverInstructions, /authoritative evidence/i);
  assert.match(serverInstructions, /explicit task-completion contract/i);
  assert.match(serverInstructions, /brief normal assistant progress messages/i);
  assert.match(serverInstructions, /Native tool invocation labels are supplemental status only/i);
  assert.match(serverInstructions, /Do not poll relai_work status merely to refresh UI/i);
  assert.doesNotMatch(serverInstructions, /Start each objective|Inspect relevant files|Validate after changes|recovery guidance/i, 'global MCP instructions must contain universal invariants rather than specialist workflow tactics');
  assert.equal(discovery.body.result?.cacheScope, 'private');
  assert.ok(Number.isFinite(discovery.body.result?.ttlMs) && discovery.body.result.ttlMs > 0, 'discovery cache TTL must remain finite and positive');
  assert.equal(discovery.response.headers.get('mcp-session-id'), null);

  const largeConfiguredRequest = await client.request('server/discover', {
    padding: 'x'.repeat((10 * 1024 * 1024) + (128 * 1024))
  });
  assert.notEqual(largeConfiguredRequest.response.status, 413, 'MCP request handling must honor the configured body limit instead of imposing a second 10 MiB cap');

  const liveDashboard = await fetch(`${base}/api/dashboard/v10`, { headers: dashboardHeaders }).then(response => response.json());
  assert.equal(liveDashboard.mcpConnection.status, 'ready');
  assert.equal(liveDashboard.mcpConnection.requestModel, 'stateless');
  assert.equal(Object.hasOwn(liveDashboard.mcpConnection, 'connectedClientCount'), false);
  assert.equal(Object.hasOwn(liveDashboard.mcpConnection, 'activeSessions'), false);

  const listed = await client.request('tools/list');
  assert.equal(listed.body.result?.tools?.length, activeMcpToolCount);
  const listedToolBytes = Buffer.byteLength(JSON.stringify({ tools: listed.body.result.tools }));
  assert.ok(listedToolBytes > 0, 'HTTP tools/list must serialize to a non-empty response');
  const names = listed.body.result.tools.map(tool => tool.name);
  const publicNames = listed.body.result.tools.filter(tool => activeToolNames.includes(tool.name)).map(tool => tool.name);
  assert.deepEqual(publicNames, activeToolNames, 'HTTP discovery must retain the canonical 12-tool model surface');
  const listedByName = new Map(listed.body.result.tools.map(tool => [tool.name, tool]));
  for (const name of activeToolNames) {
    assert.deepEqual(listedByName.get(name)?._meta?.securitySchemes, [{ type: 'noauth' }], `${name} must advertise noauth through ChatGPT compatibility metadata`);
    assert.equal(listedByName.get(name)?._meta?.ui, undefined, `${name} must stay iframe-free`);
    assert.equal(listedByName.get(name)?._meta?.['openai/outputTemplate'], undefined, `${name} must not attach a ChatGPT output template`);
  }
  assert.deepEqual(listedByName.get('relai_publish')?.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
  assert.equal(listedByName.has('relai_approval'), false);
  assert.equal(listedByName.has('relai_app_approval_decide'), false);
  for (const expected of activeToolNames) assert.ok(names.includes(expected), `${expected} missing`);
  for (const legacy of ['relai_begin_work', 'relai_process_start', 'relai_run_checks', 'relai_git_push']) {
    assert.equal(names.includes(legacy), false, `${legacy} must not be exposed by the unified surface`);
  }
  const inspect = listed.body.result.tools.find(tool => tool.name === 'relai_inspect');
  assert.ok(inspect.inputSchema.properties.action.enum.includes('trace'));
  assert.equal(inspect.outputSchema?.type, 'object');
  assert.equal(inspect.execution, undefined);
  const process = listed.body.result.tools.find(tool => tool.name === 'relai_process');
  assert.equal(process.execution, undefined);
  assert.equal(process.outputSchema?.type, 'object');
  const checks = listed.body.result.tools.find(tool => tool.name === 'relai_validate');
  assert.equal(checks.execution, undefined);
  assert.equal(checks.outputSchema?.type, 'object');
  assert.equal(checks.inputSchema.properties.planId, undefined);
  assert.equal(checks.inputSchema.properties.planLevel, undefined);
  assert.equal(checks.inputSchema.properties.defer, undefined);

  const status = await client.request('tools/call', {
    name: 'relai_work',
    arguments: { action: 'status', workspace: 'repo' }
  });
  assert.equal(status.response.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.result?.isError, false, JSON.stringify(status.body));
  assert.equal(status.body.result?.structuredContent?.ok, true);
  assert.equal(status.body.result?._meta?.relai, undefined, 'native status results must not carry Rel.AI component hydration metadata');

  const missingWorkspace = await client.request('tools/call', {
    name: 'relai_work',
    arguments: { action: 'begin' }
  });
  assert.equal(missingWorkspace.response.status, 200, JSON.stringify(missingWorkspace.body));
  assert.equal(missingWorkspace.body.result?.isError, true, JSON.stringify(missingWorkspace.body));
  assert.match(JSON.stringify(missingWorkspace.body.result || {}), /workspace/i, 'public schema validation must reject missing begin workspace before runtime dispatch');

  const started = await client.request('tools/call', {
    name: 'relai_work',
    arguments: { action: 'begin', workspace: root, bootstrap: 'none' },
    _meta: { 'openai/session': 'chat-session-regression' }
  });
  assert.equal(started.response.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.result?.isError, false, JSON.stringify(started.body));
  assert.equal(started.body.result?._meta?.relai, undefined, 'begin results must not request ChatGPT iframe hydration');
  const workId = started.body.result?.structuredContent?.work_id;
  assert.match(workId || '', /^[0-9a-f-]{36}$/i, 'HTTP Apps transport must start work from a configured workspace path');
  const persistedTask = readTaskHistorySessionRecord(config, workId, { reconcileInactive: false });
  assert.equal(persistedTask?.correlation?.conversationId, 'chat-session-regression', 'ChatGPT session metadata must persist as internal task correlation without leaking into compact model-visible status');
  const validationWithExplicitLevel = await client.request('tools/call', {
    name: 'relai_validate',
    arguments: {
      action: 'checks',
      work_id: workId,
      level: 'standard',
      check: `${JSON.stringify(globalThis.process.execPath)} -e "process.stdout.write('schema-parity-ok')"`,
      timeoutMs: 5_000,
      fullOutput: true
    }
  });
  assert.equal(validationWithExplicitLevel.response.status, 200, JSON.stringify(validationWithExplicitLevel.body));
  assert.equal(validationWithExplicitLevel.body.error, undefined, 'publicly valid level + explicit check must not fail transport preflight');
  assert.equal(validationWithExplicitLevel.body.result?.isError, false, JSON.stringify(validationWithExplicitLevel.body));
  assert.equal(validationWithExplicitLevel.body.result?.structuredContent?.validationStatus, 'passed');
  const missingExecMode = await client.request('tools/call', {
    name: 'relai_exec',
    arguments: { work_id: workId }
  });
  assert.equal(missingExecMode.response.status, 200, JSON.stringify(missingExecMode.body));
  assert.equal(missingExecMode.body.error, undefined, 'tool-level argument failures must stay inside a normal tools/call result instead of becoming connector-level JSON-RPC errors');
  assert.equal(missingExecMode.body.result?.isError, true, JSON.stringify(missingExecMode.body));
  assert.equal(missingExecMode.body.result?.structuredContent?.errorCode, 'INVALID_TOOL_ARGUMENTS');
  assert.match(missingExecMode.body.result?.structuredContent?.error || '', /command|executable/i, 'task-aware preflight validation must explain the rejected input without escaping the tool-result boundary');

  const invalidValidationArguments = await client.request('tools/call', {
    name: 'relai_validate',
    arguments: {
      action: 'checks',
      work_id: workId,
      level: 'standard',
      check: 42
    }
  });
  assert.equal(invalidValidationArguments.response.status, 200, JSON.stringify(invalidValidationArguments.body));
  assert.equal(invalidValidationArguments.body.error, undefined, 'invalid validator arguments must not surface as a connector-level protocol failure');
  assert.equal(invalidValidationArguments.body.result?.isError, true, JSON.stringify(invalidValidationArguments.body));
  assert.equal(invalidValidationArguments.body.result?.structuredContent?.errorCode, 'INVALID_TOOL_ARGUMENTS');
  assert.match(invalidValidationArguments.body.result?.structuredContent?.error || '', /invalid arguments|check/i);

  const unknownValidationField = await client.request('tools/call', {
    name: 'relai_validate',
    arguments: {
      action: 'checks',
      work_id: workId,
      check: 'node -v',
      unexpected: true
    }
  });
  assert.equal(unknownValidationField.response.status, 200, JSON.stringify(unknownValidationField.body));
  assert.equal(unknownValidationField.body.error, undefined, 'malformed long-running tool calls must not fall back to SDK -32602 validation');
  assert.equal(unknownValidationField.body.result?.isError, true, JSON.stringify(unknownValidationField.body));
  assert.equal(unknownValidationField.body.result?.structuredContent?.errorCode, 'INVALID_TOOL_ARGUMENTS');
  assert.match(unknownValidationField.body.result?.structuredContent?.error || '', /unexpected|invalid arguments/i);

  const concurrentCalls = await Promise.all(Array.from({ length: 12 }, () => client.request('tools/call', {
    name: 'relai_exec',
    arguments: {
      work_id: workId,
      executable: process.execPath,
      argv: ['-e', 'setTimeout(() => {}, 1000)'],
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024
    }
  })));
  assert.deepEqual(
    concurrentCalls.map(item => item.response.status),
    Array(12).fill(200),
    'independent HTTP requests from one MCP client must not be rejected by an arbitrary transport concurrency gate'
  );

  const cancelled = await client.request('tools/call', {
    name: 'relai_work',
    arguments: { action: 'cancel', work_id: workId, reason: 'HTTP begin regression completed.' }
  });
  assert.equal(cancelled.body.result?.isError, false, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.result?.structuredContent?.work_id, workId);

  const secondaryPath = path.join(stateDir, 'secondary-workspace');
  fs.mkdirSync(secondaryPath);
  const workspaceMutation = await fetch(`${base}/api/workspaces`, {
    method: 'POST',
    headers: { ...dashboardHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'upsert',
      alias: 'secondary',
      workspaceConfig: { mode: 'create', path: secondaryPath }
    })
  }).then(response => response.json());
  assert.equal(workspaceMutation.ok, true);
  const changedDashboard = await fetch(`${base}/api/dashboard/v10`, { headers: dashboardHeaders }).then(response => response.json());
  assert.equal(changedDashboard.mcpConnection.status, 'ready');
  assert.equal(changedDashboard.mcpConnection.metrics.toolManifestChanges, 0);
  assert.equal(Object.hasOwn(changedDashboard.mcpConnection.metrics, 'capabilityMismatches'), false);

  const synchronizedTools = await client.request('tools/list');
  assert.equal(synchronizedTools.body.result?.tools?.length, activeMcpToolCount);
  const synchronizedDashboard = await fetch(`${base}/api/dashboard/v10`, { headers: dashboardHeaders }).then(response => response.json());
  assert.equal(synchronizedDashboard.mcpConnection.status, 'ready');
  assert.equal(synchronizedDashboard.mcpConnection.toolManifestVersion, liveDashboard.mcpConnection.toolManifestVersion);

  const secondaryIndexDirectory = path.dirname(repositoryIndexPath({ stateDir }, { alias: 'secondary', path: secondaryPath }));
  fs.mkdirSync(secondaryIndexDirectory, { recursive: true });
  fs.writeFileSync(path.join(secondaryIndexDirectory, 'stale-cache-marker'), 'delete me\n');
  const workspaceDelete = await fetch(`${base}/api/workspaces`, {
    method: 'POST',
    headers: { ...dashboardHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'delete', alias: 'secondary', confirmDelete: true })
  }).then(response => response.json());
  assert.equal(workspaceDelete.ok, true);
  assert.equal(fs.existsSync(secondaryIndexDirectory), false,
    'deleting a project must remove its Repository Intelligence cache immediately');

  const resources = await client.request('resources/list');
  assert.ok(resources.body.result.resources.some(item => item.uri === 'relai://server/tool-surface'));
  assert.equal(resources.body.result.resources.some(item => item.uri === 'ui://relai/approval/v1.html'), false, 'resource discovery must not advertise the removed approval card');
  assert.equal(resources.body.result._meta?.['io.modelcontextprotocol/cache']?.cacheScope || resources.body.result.cacheScope || 'private', 'private');

  const surface = await client.request('resources/read', { uri: 'relai://server/tool-surface' });
  assert.ok(surface.body.result?.contents, JSON.stringify(surface.body));
  const manifest = JSON.parse(surface.body.result.contents[0].text);
  assert.equal(manifest.toolSurfaceVersion, activeToolSurface.toolSurfaceVersion);
  assert.equal(Object.hasOwn(manifest, 'profile'), false);
  assert.equal(manifest.toolCount, activeToolCount);
  assert.equal(manifest.toolCount, manifest.tools.length);
  const surfaceByName = new Map(manifest.tools.map(tool => [tool.name, tool]));
  assert.equal(surfaceByName.get('relai_exec').executionClass, 'native_task_eligible');
  assert.equal(surfaceByName.get('relai_exec').taskSupport, 'optional');
  assert.equal(surfaceByName.get('relai_process').executionClass, 'persistent_process');
  assert.equal(surfaceByName.get('relai_process').taskSupport, 'forbidden');
  const validateActions = new Map(surfaceByName.get('relai_validate').actions.map(item => [item.action, item]));
  assert.equal(validateActions.get('checks').taskSupport, 'optional');
  assert.equal(validateActions.get('diagnostics').taskSupport, 'optional');
  assert.equal(validateActions.get('http').taskSupport, 'optional');
  assert.equal(validateActions.get('http').executionClass, 'native_task_eligible');
  assert.equal(manifest.cache.cacheScope, 'private');
  assert.ok(manifest.cache.revision);

  const removed = await client.request('tools/call', { name: 'relai_config', arguments: {} });
  assert.equal(Boolean(removed.body.error?.code || removed.body.result?.isError), true);

  const mismatch = await client.request('tools/call', { name: 'relai_work', arguments: { action: 'status' } }, { name: 'wrong-name' });
  assert.equal(mismatch.response.status, 400);
  assert.match(mismatch.body.error?.message || '', /does not match/);

  const undeclaredParam = await client.request('tools/call', {
    name: 'relai_work',
    arguments: { action: 'status', workspace: 'repo' }
  }, { extraHeaders: { 'mcp-param-extra': 'not-declared' } });
  assert.equal(undeclaredParam.response.status, 400);
  assert.match(undeclaredParam.body.error?.message || '', /not declared/);

  const getMcp = await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(getMcp.status, 405);
  assert.equal(getMcp.headers.get('allow'), 'POST');
} finally {
  if (client) await client.close().catch(() => {});
  await stopHttpTestServer(child);
  assert.equal(fs.readFileSync(profile, 'utf8'), originalProfile);
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('HTTP MCP 2026-07-28 discovery, stateless tools, resources, dashboard, and POST-only lifecycle smoke test passed.');
