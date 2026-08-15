import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { approvalRequirement } from '../src/mcp/approval.js';
import { requiredCapability } from '../src/mcp/authorizationPolicy.js';
import { buildToolManifest, stableJson } from '../src/mcp/toolManifest.js';
import { catalogApprovalRequirement, getToolActionCatalog } from '../src/tools/actionCatalog.js';
import { resolveExecutableToolCall } from '../src/tools/runtimeRegistry.js';
import { getToolDefinitions, getToolMetadata, getToolSurfaceManifest } from '../src/tools/schema.js';

const gatewayManifest = buildToolManifest({});
const gatewayCanonical = {
  schemaVersion: gatewayManifest.schemaVersion,
  toolSurfaceVersion: gatewayManifest.toolSurfaceVersion,
  instructions: gatewayManifest.instructions,
  tools: gatewayManifest.tools
};
const gatewayHash = value => crypto.createHash('sha256').update(stableJson(value)).digest('base64url');
assert.equal(gatewayManifest.hash, gatewayHash(gatewayCanonical), 'gateway manifest hash must cover the full canonical public contract');
assert.notEqual(
  gatewayHash({ ...gatewayCanonical, instructions: `${gatewayCanonical.instructions} changed` }),
  gatewayManifest.hash,
  'server instruction changes must change the gateway manifest hash'
);
const firstTool = gatewayCanonical.tools[0];
const outputChanged = {
  ...gatewayCanonical,
  tools: [{ ...firstTool, outputSchema: { ...firstTool.outputSchema, description: 'changed output contract' } }, ...gatewayCanonical.tools.slice(1)]
};
assert.notEqual(gatewayHash(outputChanged), gatewayManifest.hash, 'output schema changes must change the gateway manifest hash');

const definitions = getToolDefinitions();
const metadata = getToolMetadata();
const metadataByName = new Map(metadata.map(item => [item.name, item]));
const manifestByName = new Map(getToolSurfaceManifest().tools.map(item => [item.name, item]));
const catalog = getToolActionCatalog();

assert.ok(definitions.length > 0, 'the public tool contract must not be empty');
assert.ok(catalog.length >= definitions.length, 'every public tool must resolve to at least one operation');
assert.equal(new Set(definitions.map(item => item.name)).size, definitions.length, 'public tool names must remain unique');
assert.equal(new Set(catalog.map(item => `${item.publicTool}:${item.action}`)).size, catalog.length, 'public tool/action keys must remain unique');

const editDefinition = definitions.find(definition => definition.name === 'relai_edit');
assert.ok(editDefinition, 'relai_edit definition must exist');
assert.match(editDefinition.description, /one logical updateText (?:patch|operation)/i, 'large repository-wide changes should stay together instead of being split into repeated edit batches');

const semanticWithMaxBytes = resolveExecutableToolCall('relai_search', {
  workspace: 'fixture', work_id: 'work_contract', action: 'semantic', query: 'needle', maxBytes: 4096
}, {});
assert.equal(semanticWithMaxBytes.operationArgs.maxBytes, 4096, 'semantic search must accept maxBytes advertised by the public tool schema');
const processReadWithWorkspace = resolveExecutableToolCall('relai_process', {
  workspace: 'fixture', work_id: 'work_contract', action: 'read', processId: 'proc_test'
}, {});
assert.equal(processReadWithWorkspace.operationArgs.workspace, 'fixture', 'process read must accept workspace advertised by the public action schema');
const processWriteWithWorkspace = resolveExecutableToolCall('relai_process', {
  workspace: 'fixture', work_id: 'work_contract', action: 'write', processId: 'proc_test', input: 'x'
}, {});
assert.equal(processWriteWithWorkspace.operationArgs.workspace, 'fixture', 'process write must accept workspace advertised by the public action schema');
const processStopWithWorkspace = resolveExecutableToolCall('relai_process', {
  workspace: 'fixture', work_id: 'work_contract', action: 'stop', processId: 'proc_test'
}, {});
assert.equal(processStopWithWorkspace.operationArgs.workspace, 'fixture', 'process stop must accept workspace advertised by the public action schema');
const scopedDiff = resolveExecutableToolCall('relai_changes', {
  workspace: 'fixture', work_id: 'work_contract', action: 'diff', scope: 'task'
}, {});
assert.equal(scopedDiff.operationArgs.scope, 'task', 'diff scope must be exposed by the public action contract');
const restoreWithIrrelevantScope = resolveExecutableToolCall('relai_changes', {
  workspace: 'fixture', work_id: 'work_contract', action: 'restore', paths: ['README.md'], scope: 'task'
}, {});
assert.equal(restoreWithIrrelevantScope.operationArgs.scope, undefined, 'known fields from another action should be ignored before runtime dispatch');

const resolvedKeys = [];
for (const entry of catalog) {
  const args = sampleArgs(entry);
  const resolved = resolveExecutableToolCall(entry.publicTool, args, {});
  assert.ok(resolved, `${entry.publicTool}:${entry.action} must resolve`);
  resolvedKeys.push(`${entry.publicTool}:${entry.action}`);
  assert.equal(resolved.operationName, entry.operationName);
  assert.equal(resolved.executionDefinition.handlerName, entry.handlerName);
  assert.equal(typeof resolved.executionDefinition.handler, 'function');
  assert.equal(requiredCapability(resolved.operationName), entry.capability);
  assert.deepEqual(resolved.executionDefinition.behavior, entry.behavior);
  assert.deepEqual(resolved.executionDefinition.execution, entry.execution);

  const publicMetadata = metadataByName.get(entry.publicTool);
  assert.ok(publicMetadata, `${entry.publicTool} must have public metadata`);
  const actionMetadata = entry.action === 'default'
    ? publicMetadata
    : publicMetadata.actions.find(item => item.action === entry.action);
  assert.ok(actionMetadata, `${entry.publicTool}:${entry.action} must have public action metadata`);
  assert.equal(actionMetadata.executionClass, entry.behavior.executionClass);
  assert.equal(actionMetadata.taskSupport, entry.execution?.taskSupport || 'forbidden');
  if (entry.action !== 'default') {
    assert.deepEqual(actionMetadata.annotations, resolved.executionDefinition.annotations);
    assert.equal(actionMetadata.taskScope, entry.behavior.taskScope);
    assert.equal(actionMetadata.concurrencyScope, entry.behavior.concurrencyScope);
  }

  const manifestTool = manifestByName.get(entry.publicTool);
  assert.ok(manifestTool, `${entry.publicTool} must be present in the tool-surface manifest`);
  const manifestAction = entry.action === 'default'
    ? manifestTool
    : manifestTool.actions.find(item => item.action === entry.action);
  assert.ok(manifestAction, `${entry.publicTool}:${entry.action} must be present in the tool-surface manifest`);
  assert.equal(manifestAction.executionClass, entry.behavior.executionClass);
  assert.equal(manifestAction.taskSupport, entry.execution?.taskSupport || 'forbidden');

  assert.deepEqual(
    catalogApprovalRequirement(entry.publicTool, args),
    approvalRequirement(entry.publicTool, args),
    `${entry.publicTool}:${entry.action} approval policy must have one meaning across the catalog and runtime`
  );
  if (entry.operationName === 'relai_git_commit') {
    const addAllArgs = { ...args, addAll: true };
    assert.deepEqual(catalogApprovalRequirement(entry.publicTool, addAllArgs), approvalRequirement(entry.publicTool, addAllArgs));
  }
}

const discoveredKeys = definitions.flatMap(definition => {
  const actions = metadataByName.get(definition.name)?.actions || [];
  return actions.length ? actions.map(action => `${definition.name}:${action.action}`) : [`${definition.name}:default`];
});
assert.deepEqual(resolvedKeys.sort(), discoveredKeys.sort(), 'every discovered public action must be executable through the canonical resolver');

assert.ok(approvalRequirement('relai_changes', { action: 'reset', work_id: 'work_contract', confirmation: 'RESET' }), 'workspace reset must remain approval-gated');
assert.ok(approvalRequirement('relai_publish', { action: 'push', work_id: 'work_contract' }), 'Git push must remain approval-gated');
assert.equal(approvalRequirement('relai_publish', { action: 'commit', work_id: 'work_contract', message: 'Contract commit' }), null, 'scoped commit should not require extra approval');
assert.ok(approvalRequirement('relai_publish', { action: 'commit', work_id: 'work_contract', message: 'Contract commit', addAll: true }), 'commit --all must remain approval-gated');

console.log(`Dynamic public contract parity passed for ${definitions.length} tools and ${catalog.length} actions.`);

function sampleArgs(entry) {
  const key = `${entry.publicTool}:${entry.action}`;
  const args = entry.action === 'default' ? {} : { action: entry.action };
  if (entry.behavior?.taskScope === 'required') args.work_id = 'work_contract';
  switch (key) {
    case 'relai_work:begin': args.workspace = 'repo'; break;
    case 'relai_work:finish': args.summary = 'Completed.'; break;
    case 'relai_search:text': args.pattern = 'needle'; break;
    case 'relai_search:semantic': args.query = 'needle'; break;
    case 'relai_inspect:symbol':
    case 'relai_inspect:references':
    case 'relai_inspect:trace': args.symbol = 'target'; break;
    case 'relai_inspect:related': args.query = 'target'; break;
    case 'relai_inspect:impact': args.paths = ['src/index.js']; break;
    case 'relai_exec:default': args.command = 'node --version'; break;
    case 'relai_process:start': Object.assign(args, { command: 'node server.js', kind: 'service', purpose: 'Contract parity.' }); break;
    case 'relai_process:read':
    case 'relai_process:stop': args.processId = 'proc_contract'; break;
    case 'relai_process:write': Object.assign(args, { processId: 'proc_contract', input: 'status\n' }); break;
    case 'relai_ui:start': args.port = 3000; break;
    case 'relai_ui:navigate': Object.assign(args, { sessionId: 'ui_abcdefghijklmnopqrst', route: '/' }); break;
    case 'relai_ui:snapshot':
    case 'relai_ui:screenshot':
    case 'relai_ui:console':
    case 'relai_ui:network':
    case 'relai_ui:reload':
    case 'relai_ui:stop': args.sessionId = 'ui_abcdefghijklmnopqrst'; break;
    case 'relai_ui:interact': Object.assign(args, { sessionId: 'ui_abcdefghijklmnopqrst', interaction: 'click', target: { by: 'text', value: 'Save' } }); break;
    case 'relai_ui:viewport': Object.assign(args, { sessionId: 'ui_abcdefghijklmnopqrst', width: 1280, height: 720 }); break;
    case 'relai_validate:http': args.route = '/health'; break;
    case 'relai_changes:restore': args.paths = ['README.md']; break;
    case 'relai_changes:reset': args.confirmation = 'RESET'; break;
    case 'relai_changes:tidy_run': args.planId = 'tidy_abcdefghijklmnopqrst'; break;
    case 'relai_publish:commit': args.message = 'Contract commit'; break;
  }
  return args;
}
