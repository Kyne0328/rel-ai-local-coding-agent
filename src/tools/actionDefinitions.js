// @ts-check

import { publicEditInputSchema, publicExecInputSchema, publicProcessInputSchema } from './publicOperationSchemas.js';
import { ACTION_REGISTRY, OPERATION_REGISTRY } from './actionRegistry.js';
import { MAX_BATCH_EDITS } from '../editLimits.js';
import { outputSchemaFor } from './outputSchemas.js';
import { OPERATION_IDS as OP } from './operationIds.js';

/** @typedef {import('../../types/boundaries.d.ts').ToolDefinitionMetadata} ToolDefinitionMetadata */
/** @typedef {Omit<ToolDefinitionMetadata, 'annotations' | 'connectorStrip' | 'groups' | 'behavior' | 'dashboard' | 'outputSchema'> & { annotations?: Partial<ToolDefinitionMetadata['annotations']>, connectorStrip?: string[], groups?: import('../../types/boundaries.d.ts').ToolGroup[], behavior?: Partial<ToolDefinitionMetadata['behavior']>, dashboard?: Partial<ToolDefinitionMetadata['dashboard']>, outputSchema?: import('../../types/boundaries.d.ts').JsonSchema }} ToolDefinitionInput */

/** @type {Set<string>} */
const READ_ONLY_TOOLS = new Set([
  OP.SNAPSHOT, OP.READ, OP.SEARCH_TEXT, OP.INSPECT, OP.SEARCH_SEMANTIC,
  OP.PROCESS_READ, OP.PROCESS_LIST, OP.CHANGES_TIDY_PLAN, OP.VALIDATE_HTTP, OP.CHANGES_DIFF, OP.CHANGES_REPLAY,
  OP.WORK_STATUS, OP.PUBLISH_DRAFT_PR
]);
/** @type {Set<string>} */
const DESTRUCTIVE_TOOLS = new Set([
  OP.EXEC, OP.PROCESS_START, OP.PROCESS_WRITE, OP.PROCESS_STOP, OP.UI, OP.COMPUTER,
  OP.VALIDATE_DIAGNOSTICS, OP.CHANGES_TIDY_RUN, OP.VALIDATE_CHECKS, OP.CHANGES_RESTORE,
  OP.CHANGES_RESET, OP.EDIT, OP.SKILL_MANAGE
]);
/** @type {Set<string>} */
const IDEMPOTENT_TOOLS = new Set([
  ...READ_ONLY_TOOLS, OP.PROCESS_STOP, OP.CHANGES_RESTORE, OP.CHANGES_RESET,
  OP.WORK_CANCEL, OP.WORK_FINISH
]);
/** @type {Set<string>} */
const OPEN_WORLD_TOOLS = new Set([
  OP.EXEC, OP.PROCESS_START, OP.PROCESS_WRITE, OP.UI, OP.COMPUTER,
  OP.VALIDATE_DIAGNOSTICS, OP.VALIDATE_CHECKS, OP.PUBLISH_PUSH
]);
// These operations use Native MCP Tasks when the connected client explicitly negotiates
// the Tasks capability. Clients without it keep the same public operations, but long work
// can continue under work_id after the tool response returns; no legacy operation names are retained.
/** @type {Set<string>} */
const NATIVE_TASK_ELIGIBLE_TOOLS = new Set([
  OP.SEARCH_SEMANTIC,
  OP.INSPECT,
  OP.EDIT,
  OP.EXEC,
  OP.VALIDATE_DIAGNOSTICS,
  OP.VALIDATE_CHECKS,
  OP.VALIDATE_HTTP
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
const OPERATION_DEFINITIONS = Object.freeze(OPERATION_REGISTRY.map(record => defineTool(record.definition)));
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
    description: 'Starts, inspects, finishes, or cancels one logical repository task. Status also reports long operations that continued after a connector request ended. File inspection and mutation are provided by separate repository tools.',
    annotations: annotations(false, false, false, false),
    behavior: { taskScope: 'optional', executionClass: 'always_immediate' },
    dashboard: { category: 'Workflow', capabilities: ['workflow'] }
  },
  {
    name: 'relai_snapshot', title: 'Repository Snapshot',
    description: 'Returns a compact repository or bootstrap overview. This read-only operation may use an authorized workspace directly without a work_id.'
  },
  {
    name: 'relai_read', title: 'Read Repository',
    description: 'Reads exact file content, ranges, directories, discovered skills, or task-scoped command output. Ordinary reads may use an authorized workspace directly without a work_id; task output remains bound to its work_id. asResource:true returns one exact file as a private resource_link for transfer or download.'
  },
  {
    name: 'relai_search', title: 'Search Repository',
    description: 'Provides lexical or semantic discovery across repository content.',
    annotations: annotations(true, false, true, false), behavior: { taskScope: 'optional' }
  },
  {
    name: 'relai_inspect', title: 'Inspect Code Relationships',
    description: 'Provides read-only symbol, reference, impact, trace, diagnostic, and architecture analysis.',
    annotations: annotations(true, false, true, false), groups: ['audit'], behavior: { taskScope: 'optional' }
  },
  {
    name: 'relai_edit', title: 'Edit Repository',
    description: 'Applies repository file or environment mutations. Supported forms include semantic rename, symbolEdit structural edits, oldText/newText exact replacement, content complete-file replacement, native ChatGPT file import, edits batches, updateText patch updates, and secret-safe environment changes. Large complete-file writes are staged internally; explicit chunked staging is available as a transport-size fallback.',
    dashboard: { capabilities: ['edit'] }
  },
  {
    name: 'relai_skill', title: 'Manage Learned Skill',
    description: 'Creates, edits, patches, or deletes one Rel.AI-managed SKILL.md. Create and update operations are task-scoped; deletion may use an authorized workspace directly without a work_id. Workspace and global scopes are supported. Rel.AI stores explicitly requested learned procedures and does not infer or merge workflow candidates automatically.',
    annotations: annotations(false, true, false, false), behavior: { taskScope: 'optional' }, dashboard: { capabilities: ['edit'] }
  },
  {
    name: 'relai_exec', title: 'Run Command',
    description: 'Runs bounded one-shot workspace commands. Long operations may continue under work_id after the connector request returns. Direct executable + argv and command-string forms are supported.',
    dashboard: { capabilities: ['execute'] }
  },
  {
    name: 'relai_process', title: 'Manage Process',
    description: 'Starts and manages persistent services, watchers, and interactive programs with stable process identity. Start and write are task-scoped; list, read, and stop can recover by authorized principal + workspace. Direct executable + argv and command-string forms are supported.',
    annotations: annotations(false, true, false, true),
    dashboard: { capabilities: ['execute'] }, behavior: { executionClass: 'persistent_process', taskScope: 'optional' }
  },
  {
    name: 'relai_ui', title: 'Test Local UI',
    description: 'Provides local UI runtime evidence and interaction in a workspace-scoped session. Start and mutating actions are task-scoped; snapshot, screenshot, console/network observation, and stop can recover by authenticated principal + workspace + sessionId.',
    annotations: annotations(false, true, false, true), dashboard: { capabilities: ['execute'] }
  },
  {
    name: 'relai_computer', title: 'Control Computer',
    description: 'Provides user-authorized control of the local computer running Rel.AI, including display inspection, screenshots, pointer input, scrolling, typing, and key input. Availability is controlled by the Computer control setting in Settings > App.',
    annotations: annotations(false, true, false, true), dashboard: { capabilities: ['execute'] }
  },
  {
    name: 'relai_validate', title: 'Validate Repository',
    description: 'Runs explicit repository checks, diagnostics, or local HTTP validation. Checks and diagnostics are task-scoped; read-only local HTTP probes may use an authorized workspace directly. Long checks can continue under work_id.',
    annotations: annotations(false, true, false, true), behavior: { longRunning: true, taskScope: 'optional' },
    dashboard: { capabilities: ['validate'] }
  },
  {
    name: 'relai_changes', title: 'Review or Restore Changes',
    description: 'Reviews, checkpoints or replays reviews, restores, resets, or tidies workspace changes. Read-only review/replay and explicitly scoped restore/reset can use an authorized workspace when their action contract permits.',
    annotations: annotations(false, true, false, false), dashboard: { capabilities: ['review', 'recover'] },
    groups: ['audit', 'cleanup'], behavior: { taskScope: 'optional' }
  },
  {
    name: 'relai_publish', title: 'Publish Repository Work',
    description: 'Commits repository changes, pushes Git branches, or drafts PR text. Commit scope defaults to task-owned paths unless explicit paths or addAll are supplied. Commit, push, and draft-PR actions may use an authorized workspace directly. Real push remains approval-gated.',
    annotations: annotations(false, false, false, true), dashboard: { capabilities: ['git'] }, groups: ['git'], behavior: { taskScope: 'optional' }
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
  const taskScope = mapping.behavior?.taskScope || operation.behavior?.taskScope || 'required';
  const taskScoped = taskScope === 'required';
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
  if (isBoundedSchemaSubset(left, right)) return right;
  if (isBoundedSchemaSubset(right, left)) return left;
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

function isBoundedSchemaSubset(candidate, superset) {
  if (!candidate || !superset || candidate.type !== superset.type) return false;
  if (candidate.type === 'number' || candidate.type === 'integer') {
    if (!hasOnlyKeys(candidate, ['type', 'minimum', 'maximum']) || !hasOnlyKeys(superset, ['type', 'minimum', 'maximum'])) return false;
    return lowerBound(candidate.minimum) >= lowerBound(superset.minimum)
      && upperBound(candidate.maximum) <= upperBound(superset.maximum);
  }
  if (candidate.type === 'string') {
    if (!hasOnlyKeys(candidate, ['type', 'minLength', 'maxLength']) || !hasOnlyKeys(superset, ['type', 'minLength', 'maxLength'])) return false;
    return lowerBound(candidate.minLength, 0) >= lowerBound(superset.minLength, 0)
      && upperBound(candidate.maxLength) <= upperBound(superset.maxLength);
  }
  if (candidate.type === 'array') {
    if (!hasOnlyKeys(candidate, ['type', 'items', 'minItems', 'maxItems']) || !hasOnlyKeys(superset, ['type', 'items', 'minItems', 'maxItems'])) return false;
    return lowerBound(candidate.minItems, 0) >= lowerBound(superset.minItems, 0)
      && upperBound(candidate.maxItems) <= upperBound(superset.maxItems)
      && isBoundedSchemaSubset(candidate.items, superset.items);
  }
  return false;
}

function hasOnlyKeys(value, allowed) {
  const allowedKeys = new Set(allowed);
  return Object.keys(value || {}).every(key => allowedKeys.has(key));
}

function lowerBound(value, fallback = Number.NEGATIVE_INFINITY) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function upperBound(value) {
  return Number.isFinite(value) ? Number(value) : Number.POSITIVE_INFINITY;
}

function getPublicActionContract(definition, action) {
  if (action === 'default') {
    const taskScope = definition.behavior?.taskScope || 'required';
    const fields = Object.keys(definition.inputSchema?.properties || {}).filter(field => field !== 'action');
    if (taskScope !== 'none' && !fields.includes('work_id')) fields.push('work_id');
    const required = [...(definition.inputSchema?.required || [])].filter(field => field !== 'action');
    if (taskScope === 'required' || taskScope === 'optional') {
      const workspaceIndex = required.indexOf('workspace');
      if (workspaceIndex >= 0) required.splice(workspaceIndex, 1);
    }
    if (taskScope === 'required' && !required.includes('work_id')) required.push('work_id');
    return Object.freeze({ fields: Object.freeze(fields.sort()), required: Object.freeze(required.sort()) });
  }
  const branch = definition.inputSchema?.oneOf?.find(item => item?.properties?.action?.const === action);
  if (!branch) throw new Error(`Public action ${definition.name}:${action} has no schema branch.`);
  const mapping = ACTION_REGISTRY[definition.name]?.[action];
  const operation = mapping ? getOperationDefinition(mapping.operationName) : null;
  const taskScope = mapping?.behavior?.taskScope || operation?.behavior?.taskScope || 'required';
  const fields = Object.keys(branch.properties || {}).filter(field => field !== 'action');
  if (taskScope !== 'none' && !fields.includes('work_id')) fields.push('work_id');
  const required = [...(branch.required || [])].filter(field => field !== 'action');
  if (taskScope === 'required' || taskScope === 'optional') {
    const workspaceIndex = required.indexOf('workspace');
    if (workspaceIndex >= 0) required.splice(workspaceIndex, 1);
  }
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
