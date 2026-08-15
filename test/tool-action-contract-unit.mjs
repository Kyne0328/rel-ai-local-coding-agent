import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { approvalRequirement } from '../src/mcp/approval.js';
import { requiredCapability } from '../src/mcp/authorizationPolicy.js';
import { buildToolManifest, canonicalValue, stableJson } from '../src/mcp/toolManifest.js';
import { resolveExecutableToolCall } from '../src/tools/runtimeRegistry.js';
import { getToolDefinitions, getToolMetadata, getToolSurfaceManifest } from '../src/tools/schema.js';

const EXPECTED_HASH = 'a84c38f815bb164548a1e5a634a50553a47982eb2daa207911f196ba5e6f70f7';
const rows = `
relai_work|begin|relai_begin_work|startTask|repository:read|none|none|task|always_immediate|forbidden
relai_work|status|relai_status|status|repository:read|none|optional|task|always_immediate|forbidden
relai_work|finish|relai_finish_work|completeTask|repository:read|none|required|task|always_immediate|forbidden
relai_work|cancel|relai_cancel_work|cancelTask|repository:read|none|required|task|always_immediate|forbidden
relai_snapshot|default|relai_repo_snapshot|repoSnapshot|repository:read|none|required|task|always_immediate|forbidden
relai_read|default|relai_read|read|repository:read|none|required|task|always_immediate|forbidden
relai_search|text|relai_search|search|repository:read|none|required|task|always_immediate|forbidden
relai_search|semantic|relai_semantic_search|semanticSearch|repository:read|none|required|task|bounded_synchronous|forbidden
relai_inspect|symbol|relai_code_inspect|codeInspect|repository:read|none|required|task|bounded_synchronous|forbidden
relai_inspect|references|relai_code_inspect|codeInspect|repository:read|none|required|task|bounded_synchronous|forbidden
relai_inspect|related|relai_code_inspect|codeInspect|repository:read|none|required|task|bounded_synchronous|forbidden
relai_inspect|impact|relai_code_inspect|codeInspect|repository:read|none|required|task|bounded_synchronous|forbidden
relai_inspect|trace|relai_code_inspect|codeInspect|repository:read|none|required|task|bounded_synchronous|forbidden
relai_inspect|diagnostics|relai_code_inspect|codeInspect|repository:read|none|required|task|bounded_synchronous|forbidden
relai_inspect|architecture|relai_code_inspect|codeInspect|repository:read|none|required|task|bounded_synchronous|forbidden
relai_edit|default|relai_edit|edit|repository:write|none|required|task|bounded_synchronous|forbidden
relai_exec|default|relai_exec|exec|command:execute|none|required|task|bounded_synchronous|forbidden
relai_process|start|relai_process_start|processStart|process:manage|none|required|task|persistent_process|forbidden
relai_process|read|relai_process_read|processRead|repository:read|none|required|task|persistent_process|forbidden
relai_process|write|relai_process_write|processWrite|process:manage|none|required|task|persistent_process|forbidden
relai_process|stop|relai_process_stop|processStop|process:manage|none|required|task|persistent_process|forbidden
relai_process|list|relai_process_list|processList|repository:read|none|required|task|persistent_process|forbidden
relai_ui|start|relai_ui|ui|process:manage|none|required|task|bounded_synchronous|forbidden
relai_ui|navigate|relai_ui|ui|process:manage|none|required|task|bounded_synchronous|forbidden
relai_ui|snapshot|relai_ui|ui|process:manage|none|required|task|bounded_synchronous|forbidden
relai_ui|interact|relai_ui|ui|process:manage|none|required|task|bounded_synchronous|forbidden
relai_ui|screenshot|relai_ui|ui|process:manage|none|required|task|bounded_synchronous|forbidden
relai_ui|console|relai_ui|ui|process:manage|none|required|task|bounded_synchronous|forbidden
relai_ui|network|relai_ui|ui|process:manage|none|required|task|bounded_synchronous|forbidden
relai_ui|viewport|relai_ui|ui|process:manage|none|required|task|bounded_synchronous|forbidden
relai_ui|reload|relai_ui|ui|process:manage|none|required|task|bounded_synchronous|forbidden
relai_ui|stop|relai_ui|ui|process:manage|none|required|task|bounded_synchronous|forbidden
relai_validate|checks|relai_run_checks|runChecks|command:execute|none|required|task|bounded_synchronous|forbidden
relai_validate|diagnostics|relai_diagnostics_run|diagnosticsRun|command:execute|none|required|task|bounded_synchronous|forbidden
relai_validate|http|relai_http_probe|httpProbe|repository:read|none|required|task|bounded_synchronous|forbidden
relai_changes|diff|relai_diff|diff|repository:read|none|required|task|bounded_synchronous|forbidden
relai_changes|restore|relai_restore_paths|restorePaths|repository:write|none|required|workspace|bounded_synchronous|forbidden
relai_changes|reset|relai_reset_workspace|resetWorkspace|repository:write|always|required|workspace|bounded_synchronous|forbidden
relai_changes|tidy_plan|relai_tidy_plan|tidyPlan|repository:read|none|required|task|bounded_synchronous|forbidden
relai_changes|tidy_run|relai_tidy_run|tidyRun|repository:write|none|required|workspace|bounded_synchronous|forbidden
relai_publish|commit|relai_git_commit|gitCommit|repository:write|conditional|required|workspace|bounded_synchronous|forbidden
relai_publish|push|relai_git_push|gitPush|git:publish|always|required|workspace|bounded_synchronous|forbidden
relai_publish|draft_pr|relai_git_draft_pr|gitDraftPr|repository:read|none|required|task|bounded_synchronous|forbidden
`.trim().split('\n').map(line => {
  const [publicTool, action, operationName, handlerName, capability, approval, taskScope, concurrencyScope, executionClass, taskSupport] = line.split('|');
  return { publicTool, action, operationName, handlerName, capability, approval, taskScope, concurrencyScope, executionClass, taskSupport };
});

const gatewayManifest = buildToolManifest({});
const gatewayCanonical = {
  schemaVersion: gatewayManifest.schemaVersion,
  toolSurfaceVersion: gatewayManifest.toolSurfaceVersion,
  instructions: gatewayManifest.instructions,
  tools: gatewayManifest.tools
};
const gatewayHash = value => crypto.createHash('sha256').update(stableJson(value)).digest('base64url');
assert.equal(gatewayManifest.hash, gatewayHash(gatewayCanonical), 'gateway manifest hash must cover the full canonical public contract');
const instructionChanged = { ...gatewayCanonical, instructions: `${gatewayCanonical.instructions} changed` };
assert.notEqual(gatewayHash(instructionChanged), gatewayManifest.hash, 'server instruction changes must change the gateway manifest hash');
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
const contract = definitions.map(definition => contractEntry(definition, metadataByName.get(definition.name)));
const hash = crypto.createHash('sha256').update(stableJson(contract)).digest('hex');
assert.equal(definitions.length, 12);
assert.equal(rows.length, 43);
assert.equal(hash, EXPECTED_HASH, 'public tool contract changed without an explicit baseline update');
const editDefinition = definitions.find(definition => definition.name === "relai_edit");
assert.ok(editDefinition, "relai_edit definition must exist");
assert.match(editDefinition.description, /one logical updateText (?:patch|operation)/i, "large repository-wide changes should stay together instead of being split into repeated edit batches");
const semanticWithMaxBytes = resolveExecutableToolCall('relai_search', { workspace: 'fixture', work_id: 'task-1', action: 'semantic', query: 'needle', maxBytes: 4096 }, {});
assert.equal(semanticWithMaxBytes.operationArgs.maxBytes, 4096, 'semantic search must accept maxBytes advertised by the public tool schema');
const scopedDiff = resolveExecutableToolCall('relai_changes', { workspace: 'fixture', work_id: 'task-1', action: 'diff', scope: 'task' }, {});
assert.equal(scopedDiff.operationArgs.scope, 'task', 'diff scope must be exposed by the public action contract');
assert.throws(
  () => resolveExecutableToolCall('relai_changes', { workspace: 'fixture', work_id: 'task-1', action: 'restore', paths: ['README.md'], scope: 'task' }, {}),
  /Unsupported field 'scope'/,
  'scope must remain diff-only'
);

const actualKeys = [];
for (const expected of rows) {
  const args = sampleArgs(expected);
  const resolved = resolveExecutableToolCall(expected.publicTool, args, {});
  assert.ok(resolved, `${expected.publicTool}:${expected.action} must resolve`);
  actualKeys.push(`${expected.publicTool}:${expected.action}`);
  assert.equal(resolved.operationName, expected.operationName);
  assert.equal(resolved.executionDefinition.handlerName, expected.handlerName);
  assert.equal(typeof resolved.executionDefinition.handler, 'function');
  assert.equal(requiredCapability(resolved.operationName), expected.capability);
  assert.equal(resolved.executionDefinition.behavior.taskScope, expected.taskScope);
  assert.equal(resolved.executionDefinition.behavior.concurrencyScope, expected.concurrencyScope);
  assert.equal(resolved.executionDefinition.behavior.executionClass, expected.executionClass);
  assert.equal(resolved.executionDefinition.execution?.taskSupport || 'forbidden', expected.taskSupport);

  const publicMetadata = metadataByName.get(expected.publicTool);
  const actionMetadata = expected.action === 'default' ? publicMetadata : publicMetadata.actions.find(item => item.action === expected.action);
  assert.ok(actionMetadata);
  assert.equal(actionMetadata.executionClass, expected.executionClass);
  assert.equal(actionMetadata.taskSupport, expected.taskSupport);
  if (expected.action !== 'default') {
    assert.deepEqual(actionMetadata.annotations, resolved.executionDefinition.annotations);
    assert.equal(actionMetadata.taskScope, expected.taskScope);
    assert.equal(actionMetadata.concurrencyScope, expected.concurrencyScope);
  }
  const manifestTool = manifestByName.get(expected.publicTool);
  const manifestAction = expected.action === 'default' ? manifestTool : manifestTool.actions.find(item => item.action === expected.action);
  assert.equal(manifestAction.executionClass, expected.executionClass);
  assert.equal(manifestAction.taskSupport, expected.taskSupport);

  const approval = approvalRequirement(expected.publicTool, args);
  if (expected.approval === 'always') assert.ok(approval);
  if (expected.approval === 'none') assert.equal(approval, null);
  if (expected.approval === 'conditional') {
    assert.equal(approval, null);
    assert.ok(approvalRequirement(expected.publicTool, { ...args, addAll: true }));
  }
}

const discoveredKeys = definitions.flatMap(definition => {
  const actions = metadataByName.get(definition.name)?.actions || [];
  return actions.length ? actions.map(action => `${definition.name}:${action.action}`) : [`${definition.name}:default`];
});
assert.deepEqual(actualKeys.sort(), discoveredKeys.sort());
console.log(`Public contract fingerprint and ${rows.length}-action execution matrix passed.`);

function contractEntry(definition, publicMetadata) {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputFields: Object.keys(definition.inputSchema?.properties || {}).sort(),
    required: [...(definition.inputSchema?.required || [])].sort(),
    actions: (publicMetadata?.actions || []).map(action => ({
      action: action.action,
      operation: action.operation,
      fields: [...action.fields].sort(),
      required: [...action.required].sort(),
      annotations: canonicalValue(action.annotations),
      taskScope: action.taskScope,
      concurrencyScope: action.concurrencyScope,
      executionClass: action.executionClass,
      taskSupport: action.taskSupport
    })),
    annotations: canonicalValue(definition.annotations),
    taskScope: definition.behavior?.taskScope || 'required',
    concurrencyScope: definition.behavior?.concurrencyScope || 'task',
    executionClass: definition.behavior?.executionClass || 'bounded_synchronous',
    taskSupport: definition.execution?.taskSupport || 'forbidden',
    outputSchema: canonicalValue(definition.outputSchema || {})
  };
}

function sampleArgs(expected) {
  const key = `${expected.publicTool}:${expected.action}`;
  const args = expected.action === 'default' ? {} : { action: expected.action };
  if (expected.taskScope === 'required') args.work_id = 'work_contract';
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
    case 'relai_process:start': Object.assign(args, { command: 'node server.js', kind: 'service', purpose: 'Contract test.' }); break;
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
