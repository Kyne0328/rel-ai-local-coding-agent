// @ts-check

import { publicEditInputSchema, publicExecInputSchema, publicProcessInputSchema } from './publicOperationSchemas.js';
import { ACTION_REGISTRY } from './actionRegistry.js';
import { MAX_BATCH_EDITS } from '../editLimits.js';
import { outputSchemaFor } from './outputSchemas.js';
import { OPERATION_DEFINITION_VALUES } from './operationDefinitionValues.js';
import { OPERATION_IDS as OP } from './operationIds.js';

/** @typedef {import('../../types/boundaries.d.ts').ToolDefinitionMetadata} ToolDefinitionMetadata */
/** @typedef {Omit<ToolDefinitionMetadata, 'annotations' | 'connectorStrip' | 'groups' | 'behavior' | 'dashboard' | 'outputSchema'> & { annotations?: Partial<ToolDefinitionMetadata['annotations']>, connectorStrip?: string[], groups?: import('../../types/boundaries.d.ts').ToolGroup[], behavior?: Partial<ToolDefinitionMetadata['behavior']>, dashboard?: Partial<ToolDefinitionMetadata['dashboard']>, outputSchema?: import('../../types/boundaries.d.ts').JsonSchema }} ToolDefinitionInput */

/** @type {Set<string>} */
const READ_ONLY_TOOLS = new Set([
  OP.SNAPSHOT, OP.READ, OP.SEARCH_TEXT, OP.INSPECT, OP.SEARCH_SEMANTIC,
  OP.PROCESS_READ, OP.PROCESS_LIST, OP.CHANGES_TIDY_PLAN, OP.VALIDATE_HTTP, OP.CHANGES_DIFF,
  OP.WORK_STATUS, OP.PUBLISH_DRAFT_PR
]);
/** @type {Set<string>} */
const DESTRUCTIVE_TOOLS = new Set([
  OP.EXEC, OP.PROCESS_START, OP.PROCESS_WRITE, OP.PROCESS_STOP, OP.UI,
  OP.VALIDATE_DIAGNOSTICS, OP.CHANGES_TIDY_RUN, OP.VALIDATE_CHECKS, OP.CHANGES_RESTORE,
  OP.CHANGES_RESET, OP.EDIT
]);
/** @type {Set<string>} */
const IDEMPOTENT_TOOLS = new Set([
  ...READ_ONLY_TOOLS, OP.PROCESS_STOP, OP.CHANGES_RESTORE, OP.CHANGES_RESET,
  OP.WORK_CANCEL, OP.WORK_FINISH
]);
/** @type {Set<string>} */
const OPEN_WORLD_TOOLS = new Set([
  OP.EXEC, OP.PROCESS_START, OP.PROCESS_WRITE, OP.UI,
  OP.VALIDATE_DIAGNOSTICS, OP.VALIDATE_CHECKS, OP.PUBLISH_PUSH
]);
// These operations may use Native MCP Tasks only when the connected client explicitly
// negotiates the Tasks capability. Clients without that capability use the same current
// operations synchronously; no legacy operation names or fallback routes are retained.
/** @type {Set<string>} */
const NATIVE_TASK_ELIGIBLE_TOOLS = new Set([
  OP.EXEC,
  OP.VALIDATE_DIAGNOSTICS,
  OP.VALIDATE_CHECKS
]);
/** @type {Set<string>} */
const PERSISTENT_PROCESS_TOOLS = new Set([
  OP.PROCESS_START, OP.PROCESS_READ, OP.PROCESS_WRITE, OP.PROCESS_STOP, OP.PROCESS_LIST
]);
/** @type {Set<string>} */
const ALWAYS_IMMEDIATE_TOOLS = new Set([
  OP.WORK_BEGIN, OP.SNAPSHOT, OP.READ, OP.SEARCH_TEXT,
  OP.WORK_STATUS, OP.WORK_CANCEL, OP.WORK_FINISH
]);

const DEFAULT_BEHAVIOR = Object.freeze({
  audit: '', cache: '', startsSession: false, deferStagedSession: false, sessionWrite: false,
  summary: '', longRunning: false, taskScope: 'required', concurrencyScope: 'task', executionClass: 'bounded_synchronous'
});
const DEFAULT_DASHBOARD = Object.freeze({
  category: 'Workspace tools', requiredProfile: 'workspace', requiresApproval: false
});
const RESULT_SCHEMA = Object.freeze({
  type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: true
});

function annotationsFor(name) {
  return {
    readOnlyHint: READ_ONLY_TOOLS.has(name),
    destructiveHint: DESTRUCTIVE_TOOLS.has(name),
    idempotentHint: IDEMPOTENT_TOOLS.has(name),
    openWorldHint: OPEN_WORLD_TOOLS.has(name)
  };
}

function executionClassFor(name) {
  if (NATIVE_TASK_ELIGIBLE_TOOLS.has(name)) return 'native_task_eligible';
  if (PERSISTENT_PROCESS_TOOLS.has(name)) return 'persistent_process';
  if (ALWAYS_IMMEDIATE_TOOLS.has(name)) return 'always_immediate';
  return 'bounded_synchronous';
}

/** @param {ToolDefinitionInput} definition @returns {ToolDefinitionMetadata} */
function defineTool(definition) {
  return Object.freeze({
    ...definition,
    connectorStrip: [...(definition.connectorStrip || [])],
    groups: [...(definition.groups || [])],
    annotations: Object.freeze(annotationsFor(definition.name)),
    ...(NATIVE_TASK_ELIGIBLE_TOOLS.has(definition.name)
      ? { execution: Object.freeze({ taskSupport: 'optional' }) }
      : {}),
    outputSchema: Object.freeze(definition.outputSchema || outputSchemaFor(definition.name)),
    behavior: Object.freeze({
      ...DEFAULT_BEHAVIOR,
      ...(definition.behavior || {}),
      executionClass: executionClassFor(definition.name)
    }),
    dashboard: Object.freeze({ ...DEFAULT_DASHBOARD, ...(definition.dashboard || {}) })
  });
}

/** @type {readonly ToolDefinitionMetadata[]} */
const OPERATION_DEFINITIONS = Object.freeze(OPERATION_DEFINITION_VALUES.map(defineTool));
const OPERATION_DEFINITION_BY_NAME = new Map(OPERATION_DEFINITIONS.map(definition => [definition.name, definition]));

function getOperationDefinition(name) {
  return OPERATION_DEFINITION_BY_NAME.get(String(name || '')) || null;
}

function getOperationDefinitions() {
  return OPERATION_DEFINITIONS;
}

/** @type {Array<Record<string, any>>} */
const PUBLIC_TOOL_VALUES = [
  {
    name: 'relai_work',
    title: 'Manage Repository Work',
    description: 'Use when starting, inspecting, finishing, or cancelling one logical repository task. Do not use for file inspection or mutation itself.',
    annotations: annotations(false, false, false, false),
    behavior: { taskScope: 'optional', executionClass: 'always_immediate' },
    dashboard: { category: 'Workflow', capabilities: ['workflow'] }
  },
  {
    name: 'relai_snapshot', title: 'Repository Snapshot',
    description: 'Use when a compact repository or bootstrap overview is needed. Do not use for targeted file reads or searches.'
  },
  {
    name: 'relai_read', title: 'Read Repository',
    description: 'Use when exact file content, ranges, or directories are known and needed. Do not use for discovery across unknown locations.'
  },
  {
    name: 'relai_search', title: 'Search Repository',
    description: 'Use for lexical or semantic discovery across repository content. Do not use when the exact file and range are already known.',
    annotations: annotations(true, false, true, false)
  },
  {
    name: 'relai_inspect', title: 'Inspect Code Relationships',
    description: 'Use for symbol, reference, impact, trace, diagnostic, or architecture analysis. Do not use for plain text lookup.',
    annotations: annotations(true, false, true, false), groups: ['audit']
  },
  {
    name: 'relai_edit', title: 'Edit Repository',
    description: 'Use for repository file or environment mutations after evidence identifies the intended change. Do not use for reads or command execution. Edit with oldText/newText, content for full-file replacement, batches, or patch text; stage generated content above about 12 KiB before sending the whole payload, and keep large patches in one logical updateText operation.',
    dashboard: { capabilities: ['edit'] }
  },
  {
    name: 'relai_exec', title: 'Run Command',
    description: 'Use for bounded one-shot workspace commands. Do not use for persistent services or watchers; prefer executable + argv and use command only when command-line syntax is required.',
    dashboard: { capabilities: ['execute'] }
  },
  {
    name: 'relai_process', title: 'Manage Process',
    description: 'Use for persistent services, watchers, or interactive programs. Do not use for one-shot work; use relai_exec or relai_validate for one-shot work and prefer executable + argv.',
    annotations: annotations(false, true, false, true),
    dashboard: { capabilities: ['execute'] }, behavior: { executionClass: 'persistent_process' }
  },
  {
    name: 'relai_ui', title: 'Test Local UI',
    description: 'Use for local UI runtime evidence and interaction in a workspace-scoped session. Do not use when source inspection alone answers the question.',
    annotations: annotations(false, true, false, true), dashboard: { capabilities: ['execute'] }
  },
  {
    name: 'relai_validate', title: 'Validate Repository',
    description: 'Use for explicit checks, diagnostics, or HTTP validation. Do not rerun unchanged authoritative checks without a new mutation or reason.',
    annotations: annotations(false, true, false, true), behavior: { longRunning: true },
    dashboard: { capabilities: ['validate'] }
  },
  {
    name: 'relai_changes', title: 'Review or Restore Changes',
    description: 'Use to review, restore, reset, or tidy workspace changes. Do not use to create new source edits.',
    annotations: annotations(false, true, false, false), dashboard: { capabilities: ['review', 'recover'] },
    groups: ['audit', 'cleanup']
  },
  {
    name: 'relai_publish', title: 'Publish Repository Work',
    description: 'Use to commit, push, or draft PR text after task changes are reviewed and ready. Do not use before the publish boundary is satisfied.',
    annotations: annotations(false, false, false, true), dashboard: { capabilities: ['git'] }, groups: ['git']
  }
];

const PUBLIC_TOOL_DEFINITIONS = Object.freeze(PUBLIC_TOOL_VALUES.map(definePublicTool));
const PUBLIC_TOOL_BY_NAME = new Map(PUBLIC_TOOL_DEFINITIONS.map(definition => [definition.name, definition]));

/** @param {Record<string, any>} value */
function definePublicTool(value) {
  const mappings = ACTION_REGISTRY[value.name];
  if (!mappings) throw new Error(`Missing action registry for public tool '${value.name}'.`);
  const defaultMapping = mappings.default;
  const source = defaultMapping ? getOperationDefinition(defaultMapping.operationName) : null;
  if (defaultMapping && !source) throw new Error(`Missing internal operation '${defaultMapping.operationName}'.`);

  let inputSchema = source
    ? source.inputSchema
    : actionInputSchema(value, mappings);
  if (value.name === 'relai_edit') inputSchema = publicEditInputSchema(inputSchema, MAX_BATCH_EDITS);
  if (value.name === 'relai_exec') inputSchema = publicExecInputSchema(inputSchema);
  if (value.name === 'relai_process') inputSchema = publicProcessInputSchema(inputSchema);

  const baseBehavior = source?.behavior || DEFAULT_BEHAVIOR;
  const baseDashboard = source?.dashboard || DEFAULT_DASHBOARD;
  const baseCapabilities = source?.dashboard?.capabilities || ['inspect'];
  const dashboardMetadata = {
    ...DEFAULT_DASHBOARD,
    ...baseDashboard,
    ...(value.dashboard || {}),
    capabilities: [...(value.dashboard?.capabilities || baseCapabilities)]
  };
  return Object.freeze({
    ...(source || {}),
    name: value.name,
    title: value.title,
    description: value.description,
    handlerName: 'compactDispatch',
    inputSchema: Object.freeze(inputSchema),
    outputSchema: RESULT_SCHEMA,
    connectorStrip: Object.freeze([...(source?.connectorStrip || value.connectorStrip || [])]),
    groups: Object.freeze([...(value.groups || source?.groups || [])]),
    annotations: Object.freeze(value.annotations || source?.annotations || annotations(false, false, false, false)),
    behavior: Object.freeze({ ...DEFAULT_BEHAVIOR, ...baseBehavior, ...(value.behavior || {}) }),
    dashboard: Object.freeze({ ...dashboardMetadata, capabilities: Object.freeze(dashboardMetadata.capabilities) })
  });
}

function actionInputSchema(value, mappings) {
  const branches = Object.entries(mappings).map(([action, mapping]) => actionBranch(action, mapping));
  const properties = { action: { type: 'string', enum: Object.keys(mappings) } };
  for (const branch of branches) {
    for (const [name, fieldSchema] of Object.entries(branch.properties || {})) {
      if (name === 'action') continue;
      properties[name] = properties[name] ? mergePropertySchema(properties[name], fieldSchema) : fieldSchema;
    }
  }
  return { type: 'object', properties, required: ['action'], oneOf: branches, additionalProperties: false };
}

function actionBranch(action, mapping) {
  const operation = getOperationDefinition(mapping.operationName);
  if (!operation) throw new Error(`Missing internal operation '${mapping.operationName}'.`);
  const schema = operation.inputSchema;
  const properties = { ...(schema.properties || {}) };
  if (!mapping.keepAction) delete properties.action;
  properties.action = { type: 'string', const: action };

  const publicContract = mapping.publicContract || {};
  for (const field of publicContract.omit || []) delete properties[field];
  const taskScoped = operation.behavior?.taskScope === 'required';
  const required = new Set((schema.required || [])
    .filter(field => field !== 'action' && !(taskScoped && field === 'workspace') && Object.hasOwn(properties, field)));
  for (const field of publicContract.required || []) {
    if (Object.hasOwn(properties, field)) required.add(field);
  }
  required.add('action');

  const constraints = Object.fromEntries(Object.entries(schema)
    .filter(([key]) => !['type', 'properties', 'required', 'additionalProperties'].includes(key)));
  return {
    type: 'object',
    properties,
    required: [...required],
    ...constraints,
    ...(publicContract.extra || {}),
    additionalProperties: false
  };
}

function mergePropertySchema(left, right) {
  if (JSON.stringify(left) === JSON.stringify(right)) return left;
  const variants = [];
  for (const candidate of [left, right]) {
    if (Array.isArray(candidate?.anyOf) && Object.keys(candidate).length === 1) variants.push(...candidate.anyOf);
    else variants.push(candidate);
  }
  const unique = [];
  const seen = new Set();
  for (const variant of variants) {
    const key = JSON.stringify(variant);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(variant);
  }
  return { anyOf: unique };
}

function getPublicActionContract(definition, action) {
  if (action === 'default') {
    const taskScope = definition.behavior?.taskScope || 'required';
    const fields = Object.keys(definition.inputSchema?.properties || {}).filter(field => field !== 'action');
    if (taskScope !== 'none' && !fields.includes('work_id')) fields.push('work_id');
    const required = [...(definition.inputSchema?.required || [])].filter(field => field !== 'action');
    if (taskScope === 'required') {
      const workspaceIndex = required.indexOf('workspace');
      if (workspaceIndex >= 0) required.splice(workspaceIndex, 1);
      if (!required.includes('work_id')) required.push('work_id');
    }
    return Object.freeze({ fields: Object.freeze(fields.sort()), required: Object.freeze(required.sort()) });
  }
  const branch = definition.inputSchema?.oneOf?.find(item => item?.properties?.action?.const === action);
  if (!branch) throw new Error(`Public action ${definition.name}:${action} has no schema branch.`);
  const mapping = ACTION_REGISTRY[definition.name]?.[action];
  const operation = mapping ? getOperationDefinition(mapping.operationName) : null;
  const taskScope = operation?.behavior?.taskScope || 'required';
  const fields = Object.keys(branch.properties || {}).filter(field => field !== 'action');
  if (taskScope !== 'none' && !fields.includes('work_id')) fields.push('work_id');
  const required = [...(branch.required || [])].filter(field => field !== 'action');
  if (taskScope === 'required' && !required.includes('work_id')) required.push('work_id');
  return Object.freeze({ fields: Object.freeze(fields.sort()), required: Object.freeze(required.sort()) });
}

function annotations(readOnlyHint, destructiveHint, idempotentHint, openWorldHint) {
  return Object.freeze({ readOnlyHint, destructiveHint, idempotentHint, openWorldHint });
}

function getCatalogToolDefinition(name) {
  return PUBLIC_TOOL_BY_NAME.get(String(name || '')) || null;
}

function getCatalogToolDefinitions() {
  return PUBLIC_TOOL_DEFINITIONS;
}

export {
  getCatalogToolDefinition,
  getCatalogToolDefinitions,
  getOperationDefinition,
  getOperationDefinitions,
  getPublicActionContract
};
