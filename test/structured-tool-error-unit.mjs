import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-structured-error-'));
const workspaceRoot = path.join(tmp, 'repo');
const stateDir = path.join(tmp, 'state');
const configPath = path.join(tmp, 'config.json');
fs.mkdirSync(workspaceRoot, { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, '.env'), 'API_KEY=not-returned\n');
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: { repo: { path: workspaceRoot, testCommands: {}, commands: {} } }
}, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;
process.env.REL_AI_MCP_MAX_TOOL_RESULT_BYTES = '1200';

const { handleMessage } = require(path.join(root, 'src', 'server.js'));

try {
  const response = await handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'relai_read',
      arguments: { workspace: 'repo', paths: ['.env'], guidanceMode: 'none' }
    }
  });

  assert.equal(response.result.isError, false, 'relai_read returns per-path skips rather than throwing');
  const readPayload = response.result.structuredContent;
  assert.equal(readPayload.ok, true);
  assert.equal(readPayload.items.length, 0);
  assert.match(readPayload.skipped[0].reason, /blocked sensitive path/);
  assert.doesNotMatch(JSON.stringify(readPayload), /not-returned/);

  const dotWorkspaceResponse = await handleMessage({
    jsonrpc: '2.0',
    id: 'dot-workspace',
    method: 'tools/call',
    params: { name: 'relai_start_task', arguments: { workspace: '.' } }
  }, { publicHttpOnly: true, taskScopeId: 'mcp:fallback:test', transportType: 'streamable-http' });
  assert.equal(dotWorkspaceResponse.result.isError, true);
  const dotWorkspace = dotWorkspaceResponse.result.structuredContent;
  assert.equal(dotWorkspace.errorCode, 'WORKSPACE_AMBIGUOUS_RELATIVE_INPUT');
  assert.equal(dotWorkspace.errorDetails.workspaceInput, '.');
  assert.equal(dotWorkspace.errorDetails.workspaceMatchStatus, 'rejected_ambiguous_input');
  assert.equal(dotWorkspace.errorDetails.workspaceResolutionFailure, 'explicit_dot_has_no_authoritative_client_base');
  assert.deepEqual(dotWorkspace.errorDetails.configuredWorkspaceAliases, ['repo']);
  assert.match(dotWorkspace.error, /configured workspace alias/);

  const directPathResponse = await handleMessage({
    jsonrpc: '2.0',
    id: 'direct-path',
    method: 'tools/call',
    params: { name: 'relai_start_task', arguments: { workspace: workspaceRoot } }
  }, { publicHttpOnly: true, taskScopeId: 'mcp:fallback:path', transportType: 'streamable-http' });
  assert.equal(directPathResponse.result.isError, false);
  assert.equal(directPathResponse.result.structuredContent.workspace, 'repo');

  const unknownPath = path.join(tmp, 'unknown-repo');
  fs.mkdirSync(unknownPath);
  const unknownPathResponse = await handleMessage({
    jsonrpc: '2.0',
    id: 'unknown-path',
    method: 'tools/call',
    params: { name: 'relai_start_task', arguments: { workspace: unknownPath } }
  }, { publicHttpOnly: true, taskScopeId: 'mcp:fallback:path', transportType: 'streamable-http' });
  assert.equal(unknownPathResponse.result.isError, true);
  assert.equal(unknownPathResponse.result.structuredContent.errorCode, 'WORKSPACE_PATH_NOT_CONFIGURED');

  const omittedWorkspaceResponse = await handleMessage({
    jsonrpc: '2.0',
    id: 'omitted-workspace',
    method: 'tools/call',
    params: { name: 'relai_start_task', arguments: {} }
  }, { publicHttpOnly: true, taskScopeId: 'mcp:fallback:test', transportType: 'streamable-http' });
  assert.equal(omittedWorkspaceResponse.result.structuredContent.errorCode, 'WORKSPACE_INPUT_OMITTED');

  const writeResponse = await handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'relai_edit',
      arguments: { workspace: 'repo', path: '.env', content: 'API_KEY=replacement\n' }
    }
  });

  assert.equal(writeResponse.result.isError, true);
  const payload = writeResponse.result.structuredContent;
  assert.equal(payload.ok, false);
  assert.equal(payload.errorCode, 'SENSITIVE_PATH_RESTRICTED');
  assert.equal(payload.errorDetails.source, 'rel-ai-mcp-policy');
  assert.equal(payload.errorDetails.operation, 'write');
  assert.equal(payload.errorDetails.path, '.env');
  assert.equal(payload.errorDetails.fileClass, 'environment_secret');
  assert.equal(payload.errorDetails.retryable, false);
  assert.equal(payload.errorDetails.requiresUserConfirmation, false);
  assert.ok(payload.errorDetails.allowedAlternatives.some((item) => item.includes('.env.example')));
  assert.doesNotMatch(JSON.stringify(payload), /replacement|not-returned/);

  const largeFailureResponse = await handleMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'relai_run_checks',
      arguments: {
        workspace: 'repo',
        check: `node -e "process.stderr.write('failure-detail-'.repeat(800));process.exit(1)"`
      }
    }
  }, { publicHttpOnly: true, taskScopeId: 'test:large-structured-error' });

  assert.equal(largeFailureResponse.result.isError, true);
  const largeFailure = largeFailureResponse.result.structuredContent;
  assert.equal(largeFailure.ok, false);
  assert.equal(largeFailure.truncated, true);
  assert.ok(largeFailure.originalBytes > 1200);
  assert.equal(largeFailure.validationStatus, 'failed');
  assert.equal(largeFailure.results[0].exitCode, 1);
  assert.match(largeFailure.results[0].stderr, /failure-detail-/);
  assert.match(largeFailure.nextAction, /Fix the failing validation/);

  console.log('Structured tool errors preserve actionable diagnostics, including truncated failures.');
} finally {
  delete process.env.REL_AI_MCP_CONFIG;
  delete process.env.REL_AI_MCP_MAX_TOOL_RESULT_BYTES;
  fs.rmSync(tmp, { recursive: true, force: true });
}
