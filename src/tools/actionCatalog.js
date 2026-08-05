// @ts-check

import { MAX_BATCH_EDITS } from '../editLimits.js';
import { getToolDefinition as operationDefinition } from './registry.js';

const TOOL_SURFACE_VERSION = 32;
const STRING = Object.freeze({ type: 'string' });
const WORKSPACE = Object.freeze({ type: 'string' });
const ACTION = values => ({ type: 'string', enum: values });
const RESULT_SCHEMA = Object.freeze({
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: true
});


const PUBLIC_DEFINITION_VALUES = [
  define({
    name: 'relai_work',
    title: 'Manage Repository Work',
    description: 'Manage work sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        action: ACTION(['begin', 'status', 'finish', 'cancel']),
        workspace: WORKSPACE,
        title: { type: 'string', minLength: 1, maxLength: 100 },
        objective: { type: 'string', minLength: 1, maxLength: 500 },
        bootstrap: { type: 'string', enum: ['compact', 'full', 'none'] },
        instructionPath: { type: 'string', maxLength: 1000 },
        maxBytes: { type: 'number', minimum: 1000, maximum: 5242880 },
        summary: { type: 'string', minLength: 1, maxLength: 2000 },
        reason: { type: 'string', maxLength: 500 }
      },
      required: ['action'],
      oneOf: [
        branch('begin', ['workspace'], ['work_id', 'summary', 'reason', 'maxBytes']),
        branch('status', [], ['title', 'objective', 'bootstrap', 'instructionPath', 'summary', 'reason']),
        branch('finish', ['work_id', 'summary'], ['title', 'objective', 'bootstrap', 'instructionPath', 'maxBytes', 'reason']),
        branch('cancel', ['work_id'], ['title', 'objective', 'bootstrap', 'instructionPath', 'maxBytes', 'summary'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, false, false, false),
    behavior: { taskScope: 'optional', executionClass: 'always_immediate' },
    dashboard: { category: 'Workflow' }
  }),
  cloneOperation('relai_repo_snapshot', 'relai_snapshot', 'Repository Snapshot', 'Map repository context.'),
  cloneOperation('relai_read', 'relai_read', 'Read Repository', 'Read files, ranges, or directories.'),
  define({
    name: 'relai_search',
    title: 'Search Repository',
    description: 'Search text or rank code semantically.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['text', 'semantic']),
        pattern: { type: 'string', minLength: 1, maxLength: 1000 },
        glob: { type: 'string', maxLength: 256 },
        fixed: { type: 'boolean' },
        ignoreCase: { type: 'boolean' },
        mode: { type: 'string', enum: ['auto', 'compact', 'context'] },
        contextBefore: { type: 'number', minimum: 0, maximum: 100 },
        contextAfter: { type: 'number', minimum: 0, maximum: 100 },
        groupByFile: { type: 'boolean' },
        mergeOverlaps: { type: 'boolean' },
        maxFiles: { type: 'number', minimum: 1, maximum: 20000 },
        maxRangesPerFile: { type: 'number', minimum: 1, maximum: 100 },
        maxRangeLines: { type: 'number', minimum: 1, maximum: 1000 },
        maxBytes: { type: 'number', minimum: 1000, maximum: 393216 },
        maxResults: { type: 'number', minimum: 1, maximum: 1000 },
        query: { type: 'string', minLength: 1, maxLength: 2000 },
        pathPrefix: { type: 'string', maxLength: 500 },
        language: { type: 'string', maxLength: 80 }
      },
      required: ['action'],
      oneOf: [
        branch('text', ['pattern'], ['query', 'pathPrefix', 'language'], { maxFiles: { type: 'number', minimum: 1, maximum: 200 } }),
        branch('semantic', ['query'], ['pattern', 'glob', 'fixed', 'ignoreCase', 'mode', 'contextBefore', 'contextAfter', 'groupByFile', 'mergeOverlaps', 'maxRangesPerFile', 'maxRangeLines', 'maxBytes'], { maxResults: { type: 'number', minimum: 1, maximum: 100 } })
      ],
      additionalProperties: false
    },
    annotations: annotations(true, false, true, false)
  }),
  define({
    name: 'relai_inspect',
    title: 'Inspect Code Relationships',
    description: 'Inspect code relationships and impact.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['symbol', 'references', 'related', 'impact', 'trace', 'diagnostics']),
        symbol: { type: 'string', minLength: 1, maxLength: 256 },
        query: { type: 'string', minLength: 1, maxLength: 1000 },
        paths: { type: 'array', items: STRING, minItems: 1, maxItems: 100 },
        maxResults: { type: 'number', minimum: 1, maximum: 1000 },
        maxDepth: { type: 'number', minimum: 1, maximum: 8 },
        maxFiles: { type: 'number', minimum: 1, maximum: 20000 }
      },
      required: ['action'],
      oneOf: [
        branch('symbol', ['symbol'], ['query', 'paths', 'maxDepth']),
        branch('references', ['symbol'], ['query', 'paths', 'maxDepth']),
        branch('related', [], ['paths', 'maxDepth'], {}, {
          anyOf: [{ required: ['query'] }, { required: ['symbol'] }]
        }),
        branch('impact', [], ['query'], {}, {
          anyOf: [{ required: ['symbol'] }, { required: ['paths'] }]
        }),
        branch('trace', ['symbol'], ['query', 'paths']),
        branch('diagnostics', [], ['symbol', 'query', 'paths', 'maxResults', 'maxDepth'])
      ],
      additionalProperties: false
    },
    annotations: annotations(true, false, true, false),
    groups: ['audit']
  }),
  cloneOperation('relai_edit', 'relai_edit', 'Edit Repository', `Apply up to ${MAX_BATCH_EDITS} bounded repository edits.`),
  cloneOperation('relai_exec', 'relai_exec', 'Run Command', 'Run a bounded command.'),
  define({
    name: 'relai_process',
    title: 'Manage Process',
    description: 'Manage development processes.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['start', 'read', 'write', 'stop', 'list']),
        command: { type: 'string', minLength: 1, maxLength: 20000 },
        cwd: STRING,
        env: { type: 'object', additionalProperties: STRING },
        label: { type: 'string', maxLength: 120 },
        kind: { type: 'string', enum: ['service', 'watcher', 'interactive'] },
        purpose: { type: 'string', minLength: 1, maxLength: 300 },
        startupWaitMs: { type: 'number', minimum: 0, maximum: 30000 },
        maxLogBytes: { type: 'number', minimum: 65536, maximum: 268435456 },
        processId: { type: 'string', minLength: 1, maxLength: 200 },
        stdoutOffset: { type: 'number', minimum: 0 },
        stderrOffset: { type: 'number', minimum: 0 },
        maxBytes: { type: 'number', minimum: 1000, maximum: 1048576 },
        includeMetadata: { type: 'boolean' },
        metadataRevision: { type: 'string', minLength: 1, maxLength: 100 },
        input: { type: 'string', maxLength: 1048576 },
        graceMs: { type: 'number', minimum: 0, maximum: 30000 },
        status: { type: 'string', enum: ['starting', 'running', 'stopping', 'exited', 'failed', 'stopped', 'orphaned'] },
        activeOnly: { type: 'boolean' },
        includeTerminal: { type: 'boolean' },
        limit: { type: 'number', minimum: 1, maximum: 500 }
      },
      required: ['action'],
      oneOf: [
        branch('start', ['command', 'kind', 'purpose'], ['processId', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'input', 'graceMs', 'status', 'activeOnly', 'includeTerminal', 'limit']),
        branch('read', ['processId'], ['command', 'cwd', 'env', 'label', 'kind', 'purpose', 'startupWaitMs', 'maxLogBytes', 'input', 'graceMs', 'status', 'activeOnly', 'includeTerminal', 'limit']),
        branch('write', ['processId', 'input'], ['command', 'cwd', 'env', 'label', 'kind', 'purpose', 'startupWaitMs', 'maxLogBytes', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'graceMs', 'status', 'activeOnly', 'includeTerminal', 'limit']),
        branch('stop', ['processId'], ['command', 'cwd', 'env', 'label', 'kind', 'purpose', 'startupWaitMs', 'maxLogBytes', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'input', 'status', 'activeOnly', 'includeTerminal', 'limit']),
        branch('list', [], ['command', 'cwd', 'env', 'label', 'kind', 'purpose', 'startupWaitMs', 'maxLogBytes', 'processId', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'input', 'graceMs'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, true, false, true),
    behavior: { executionClass: 'persistent_process' }
  }),
  define({
    name: 'relai_worktree',
    title: 'Manage Worktree',
    description: 'Manage Git worktrees.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['create', 'list', 'remove']),
        name: { type: 'string', minLength: 1, maxLength: 80 },
        base: { type: 'string', maxLength: 200 },
        branch: { type: 'string', maxLength: 200 },
        alias: { type: 'string', minLength: 1, maxLength: 180 },
        force: { type: 'boolean' }
      },
      required: ['action'],
      oneOf: [
        branch('create', ['name'], ['alias', 'force']),
        branch('list', [], ['name', 'base', 'branch', 'alias', 'force']),
        branch('remove', ['alias'], ['name', 'base', 'branch'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, true, false, false),
    groups: ['git']
  }),
  define({
    name: 'relai_validate',
    title: 'Validate Repository',
    description: 'Run checks, diagnostics, or HTTP probes.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['checks', 'diagnostics', 'http']),
        level: { type: 'string', enum: ['quick', 'standard', 'release'] },
        check: { type: 'string', minLength: 1, maxLength: 20000 },
        checks: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 20000 }, minItems: 1, maxItems: 50 },
        checksText: { type: 'string', minLength: 1, maxLength: 100000 },
        command: { type: 'string', minLength: 1, maxLength: 20000 },
        commands: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 20000 }, minItems: 1, maxItems: 50 },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 86400000 },
        stopOnFailure: { type: 'boolean' },
        fullOutput: { type: 'boolean' },
        complete: { type: 'boolean' },
        summary: { type: 'string', minLength: 1, maxLength: 2000 },
        maxResults: { type: 'number', minimum: 1, maximum: 5000 },
        route: { type: 'string', minLength: 1 }
      },
      required: ['action'],
      oneOf: [
        branch('checks', [], ['command', 'commands', 'maxResults', 'route']),
        branch('diagnostics', [], ['check', 'checks', 'checksText', 'fullOutput', 'complete', 'summary', 'route']),
        branch('http', ['route'], ['level', 'check', 'checks', 'checksText', 'command', 'commands', 'stopOnFailure', 'fullOutput', 'complete', 'summary', 'maxResults'], { timeoutMs: { type: 'number', minimum: 1000, maximum: 600000 } })
      ],
      additionalProperties: false
    },
    annotations: annotations(false, true, false, true),
    execution: { taskSupport: 'optional' },
    behavior: { longRunning: true, executionClass: 'native_task_eligible' }
  }),
  define({
    name: 'relai_changes',
    title: 'Review or Restore Changes',
    description: 'Review, restore, reset, or tidy changes.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['diff', 'restore', 'reset', 'tidy_plan', 'tidy_run']),
        staged: { type: 'boolean' },
        path: STRING,
        redactSensitive: { type: 'boolean' },
        maxBytes: { type: 'number', minimum: 1000, maximum: 5242880 },
        paths: { type: 'array', items: STRING, minItems: 1, maxItems: 100 },
        confirmation: { type: 'string', enum: ['RESET', 'RESET_AND_CLEAN'] },
        removeUntracked: { type: 'boolean' },
        mode: { type: 'string', enum: ['session_untracked'] },
        maxCandidates: { type: 'number', minimum: 1, maximum: 100 },
        planId: { type: 'string', minLength: 20, maxLength: 120, pattern: '^tidy_[A-Za-z0-9_-]+$' }
      },
      required: ['action'],
      oneOf: [
        branch('diff', [], ['paths', 'confirmation', 'removeUntracked', 'mode', 'maxCandidates', 'planId']),
        branch('restore', ['paths'], ['staged', 'path', 'redactSensitive', 'maxBytes', 'confirmation', 'removeUntracked', 'mode', 'maxCandidates', 'planId']),
        branch('reset', ['confirmation'], ['staged', 'path', 'redactSensitive', 'maxBytes', 'paths', 'mode', 'maxCandidates', 'planId']),
        branch('tidy_plan', [], ['staged', 'path', 'redactSensitive', 'maxBytes', 'paths', 'confirmation', 'removeUntracked', 'planId']),
        branch('tidy_run', ['planId'], ['staged', 'path', 'redactSensitive', 'maxBytes', 'paths', 'confirmation', 'removeUntracked', 'mode', 'maxCandidates'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, true, false, false),
    groups: ['audit', 'cleanup']
  }),
  define({
    name: 'relai_publish',
    title: 'Publish Repository Work',
    description: 'Commit, push, or draft PR text.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['commit', 'push', 'draft_pr']),
        message: { type: 'string', minLength: 1, maxLength: 4000 },
        dryRun: { type: 'boolean' },
        addAll: { type: 'boolean' },
        sensitiveAuthorization: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['commit'] },
            paths: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 1000 }, minItems: 1, maxItems: 200 },
            reason: { type: 'string', minLength: 1, maxLength: 500 }
          },
          required: ['operation', 'paths', 'reason'],
          additionalProperties: false
        },
        paths: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 1000 }, minItems: 1, maxItems: 200 },
        maxBytes: { type: 'number', minimum: 1000, maximum: 5242880 },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 86400000 },
        remote: { type: 'string', minLength: 1, maxLength: 200 },
        branch: { type: 'string', minLength: 1, maxLength: 500 },
        setUpstream: { type: 'boolean' },
        base: STRING,
        head: STRING,
        title: STRING,
        body: STRING
      },
      required: ['action'],
      oneOf: [
        branch('commit', ['message'], ['remote', 'branch', 'setUpstream', 'base', 'head', 'title', 'body']),
        branch('push', [], ['message', 'addAll', 'sensitiveAuthorization', 'paths', 'maxBytes', 'base', 'head', 'title', 'body']),
        branch('draft_pr', [], ['message', 'dryRun', 'addAll', 'sensitiveAuthorization', 'paths', 'maxBytes', 'timeoutMs', 'remote', 'branch', 'setUpstream'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, false, false, true),
    groups: ['git']
  })
];

const PUBLIC_TOOL_DEFINITIONS = Object.freeze(PUBLIC_DEFINITION_VALUES);
const PUBLIC_TOOL_BY_NAME = new Map(PUBLIC_TOOL_DEFINITIONS.map(definition => [definition.name, definition]));

function branch(action, required = [], irrelevant = [], properties = {}, extra = {}) {
  return {
    properties: { action: { const: action }, ...properties },
    required: ['action', ...required],
    ...(irrelevant.length ? { xIrrelevant: irrelevant } : {}),
    ...extra
  };
}

function constrainActionProperties(inputSchema) {
  if (!Array.isArray(inputSchema?.oneOf)) return { inputSchema, actionContracts: [] };
  const actionBranches = inputSchema.oneOf.every(item => item?.properties?.action?.const);
  if (!actionBranches) return { inputSchema, actionContracts: [] };
  const candidateFields = new Set(Object.keys(inputSchema.properties || {}));
  candidateFields.add('work_id');
  const actionContracts = inputSchema.oneOf.map(item => {
    const irrelevant = item.xIrrelevant || [];
    return Object.freeze({
      action: String(item.properties.action.const),
      required: Object.freeze([...(item.required || []).filter(field => field !== 'action')]),
      fields: Object.freeze([...candidateFields].filter(field => field !== 'action' && !irrelevant.includes(field)).sort())
    });
  });
  return {
    inputSchema: {
      ...inputSchema,
      oneOf: inputSchema.oneOf.map(({ xIrrelevant: _xIrrelevant, ...item }) => item)
    },
    actionContracts
  };
}

function cloneOperation(sourceName, name, title, description) {
  const source = operationDefinition(sourceName);
  if (!source) throw new Error(`Missing internal operation definition: ${sourceName}`);
  return define({
    ...source,
    name,
    title,
    description,
    outputSchema: RESULT_SCHEMA,
    handlerName: 'compactDispatch'
  });
}

function annotations(readOnlyHint, destructiveHint, idempotentHint, openWorldHint) {
  return Object.freeze({ readOnlyHint, destructiveHint, idempotentHint, openWorldHint });
}

function define(value) {
  const {
    behavior,
    dashboard,
    connectorStrip = [],
    groups = [],
    annotations: toolAnnotations,
    outputSchema = RESULT_SCHEMA,
    ...definition
  } = value;
  const constrained = constrainActionProperties(definition.inputSchema);
  return Object.freeze({
    handlerName: 'compactDispatch',
    ...definition,
    inputSchema: Object.freeze(constrained.inputSchema),
    actionContracts: Object.freeze(constrained.actionContracts),
    behavior: Object.freeze({
      audit: '', cache: '', startsSession: false, deferStagedSession: false, sessionWrite: false,
      summary: '', longRunning: false, taskScope: 'required', concurrencyScope: 'task', executionClass: 'bounded_synchronous',
      ...(behavior || {})
    }),
    dashboard: Object.freeze({ category: 'Workspace tools', requiredProfile: 'workspace', requiresApproval: false, ...(dashboard || {}) }),
    connectorStrip: Object.freeze([...connectorStrip]),
    groups: Object.freeze([...groups]),
    annotations: Object.freeze(toolAnnotations || annotations(false, false, false, false)),
    outputSchema: Object.freeze(outputSchema)
  });
}

function getCatalogToolDefinition(name) {
  return PUBLIC_TOOL_BY_NAME.get(String(name || '')) || null;
}

function getCatalogToolDefinitions() {
  return PUBLIC_TOOL_DEFINITIONS;
}

import { schemaFromDefinition } from './schemaBuilder.js';

const ACTION_OPERATIONS = Object.freeze({
  relai_work: Object.freeze({
    begin: operation('relai_begin_work'),
    status: operation('relai_status'),
    finish: operation('relai_finish_work'),
    cancel: operation('relai_cancel_work')
  }),
  relai_snapshot: Object.freeze({ default: operation('relai_repo_snapshot') }),
  relai_read: Object.freeze({ default: operation('relai_read') }),
  relai_search: Object.freeze({
    text: operation('relai_search'),
    semantic: operation('relai_semantic_search')
  }),
  relai_inspect: Object.freeze({
    symbol: operation('relai_code_inspect', true),
    references: operation('relai_code_inspect', true),
    related: operation('relai_code_inspect', true),
    impact: operation('relai_code_inspect', true),
    trace: operation('relai_code_inspect', true),
    diagnostics: operation('relai_code_inspect', true)
  }),
  relai_edit: Object.freeze({ default: operation('relai_edit') }),
  relai_exec: Object.freeze({ default: operation('relai_exec') }),
  relai_process: Object.freeze({
    start: operation('relai_process_start'),
    read: operation('relai_process_read'),
    write: operation('relai_process_write'),
    stop: operation('relai_process_stop'),
    list: operation('relai_process_list')
  }),
  relai_worktree: Object.freeze({
    create: operation('relai_worktree_create'),
    list: operation('relai_worktree_list'),
    remove: operation('relai_worktree_remove')
  }),
  relai_validate: Object.freeze({
    checks: operation('relai_run_checks'),
    diagnostics: operation('relai_diagnostics_run'),
    http: operation('relai_http_probe')
  }),
  relai_changes: Object.freeze({
    diff: operation('relai_diff'),
    restore: operation('relai_restore_paths'),
    reset: operation('relai_reset_workspace'),
    tidy_plan: operation('relai_tidy_plan'),
    tidy_run: operation('relai_tidy_run')
  }),
  relai_publish: Object.freeze({
    commit: operation('relai_git_commit'),
    push: operation('relai_git_push'),
    draft_pr: operation('relai_git_draft_pr')
  })
});

const OPERATION_CAPABILITIES = Object.freeze({
  relai_begin_work: 'repository:read',
  relai_repo_snapshot: 'repository:read',
  relai_read: 'repository:read',
  relai_search: 'repository:read',
  relai_code_inspect: 'repository:read',
  relai_semantic_search: 'repository:read',
  relai_process_read: 'repository:read',
  relai_process_list: 'repository:read',
  relai_worktree_list: 'repository:read',
  relai_tidy_plan: 'repository:read',
  relai_http_probe: 'repository:read',
  relai_diff: 'repository:read',
  relai_status: 'repository:read',
  relai_git_draft_pr: 'repository:read',
  relai_cancel_work: 'repository:read',
  relai_finish_work: 'repository:read',
  relai_edit: 'repository:write',
  relai_restore_paths: 'repository:write',
  relai_reset_workspace: 'repository:write',
  relai_tidy_run: 'repository:write',
  relai_worktree_create: 'repository:write',
  relai_worktree_remove: 'repository:write',
  relai_git_commit: 'repository:write',
  relai_exec: 'command:execute',
  relai_diagnostics_run: 'command:execute',
  relai_run_checks: 'command:execute',
  relai_process_start: 'process:manage',
  relai_process_write: 'process:manage',
  relai_process_stop: 'process:manage',
  relai_git_push: 'git:publish'
});

const APPROVAL_POLICIES = Object.freeze({
  relai_reset_workspace: args => ({
    message: `Discard workspace changes using ${args.removeUntracked ? 'RESET_AND_CLEAN' : 'RESET'}?`
  }),
  relai_worktree_remove: args => ({
    message: `Remove managed worktree ${args.alias || ''}${args.force ? ' with force' : ''}? The Git branch will be preserved.`
  }),
  relai_git_push: args => ({
    message: `Publish branch ${args.branch || '(current branch)'} to ${args.remote || 'origin'}?`
  }),
  relai_git_commit: args => (args.addAll === true || args.sensitiveAuthorization
    ? { message: `Create the requested Git commit${args.addAll ? ' including all current changes' : ''}?` }
    : null)
});

const TOOL_ACTION_CATALOG = Object.freeze(buildCatalog());
const ACTION_BY_KEY = new Map(TOOL_ACTION_CATALOG.map(entry => [catalogKey(entry.publicTool, entry.action), entry]));
const TOOL_CATALOG = Object.freeze(PUBLIC_TOOL_DEFINITIONS.map(definition => Object.freeze({
  definition,
  actions: Object.freeze(TOOL_ACTION_CATALOG.filter(entry => entry.publicTool === definition.name))
})));

function buildCatalog() {
  const entries = [];
  for (const [publicTool, actions] of Object.entries(ACTION_OPERATIONS)) {
    const publicDefinition = PUBLIC_TOOL_BY_NAME.get(publicTool);
    if (!publicDefinition) throw new Error(`Catalog references unknown public tool '${publicTool}'.`);
    for (const [action, mapping] of Object.entries(actions)) {
      const operationMetadata = operationDefinition(mapping.operationName);
      if (!operationMetadata) {
        throw new Error(`Catalog action ${publicTool}:${action} references unknown operation '${mapping.operationName}'.`);
      }
      const contract = actionContract(publicDefinition, action, operationMetadata);
      const capability = OPERATION_CAPABILITIES[mapping.operationName];
      if (!capability) throw new Error(`Catalog operation '${mapping.operationName}' has no authorization capability.`);
      entries.push(Object.freeze({
        publicTool,
        action,
        operationName: mapping.operationName,
        keepAction: mapping.keepAction,
        title: operationMetadata.title,
        description: operationMetadata.description,
        fields: contract.fields,
        required: contract.required,
        inputSchema: operationMetadata.inputSchema,
        outputSchema: operationMetadata.outputSchema,
        annotations: operationMetadata.annotations,
        behavior: operationMetadata.behavior,
        execution: operationMetadata.execution,
        dashboard: operationMetadata.dashboard,
        groups: operationMetadata.groups,
        capability,
        approval: APPROVAL_POLICIES[mapping.operationName] || null,
        handlerName: operationMetadata.handlerName
      }));
    }
  }
  return entries;
}

function actionContract(publicDefinition, action, operationMetadata) {
  if (action === 'default') {
    const schema = schemaFromDefinition(publicDefinition).inputSchema;
    return Object.freeze({
      fields: Object.freeze(Object.keys(schema.properties || {}).filter(field => field !== 'action').sort()),
      required: Object.freeze([...(schema.required || [])].filter(field => field !== 'action').sort())
    });
  }
  const contract = publicDefinition.actionContracts?.find(item => item.action === action);
  if (!contract) throw new Error(`Catalog action ${publicDefinition.name}:${action} has no public action contract.`);
  const required = [...contract.required];
  if (operationMetadata.behavior?.taskScope === 'required' && !required.includes('work_id')) required.push('work_id');
  return Object.freeze({
    fields: Object.freeze([...contract.fields]),
    required: Object.freeze(required.sort())
  });
}

function operation(operationName, keepAction = false) {
  return Object.freeze({ operationName, keepAction });
}

function catalogKey(publicTool, action) {
  return `${publicTool}:${action || 'default'}`;
}

function getToolActionCatalog() {
  return TOOL_ACTION_CATALOG;
}

function getCatalogTools() {
  return TOOL_CATALOG;
}


function getCatalogAction(publicTool, args = {}) {
  const actions = ACTION_OPERATIONS[String(publicTool || '')];
  if (!actions) return null;
  const action = Object.hasOwn(actions, 'default') ? 'default' : String(args.action || '').trim();
  const entry = ACTION_BY_KEY.get(catalogKey(publicTool, action));
  if (!entry) {
    const choices = Object.keys(actions).filter(value => value !== 'default');
    throw new Error(`Unsupported action '${action || '(missing)'}' for ${publicTool}. Supported actions: ${choices.join(', ')}.`);
  }
  return entry;
}

function catalogApprovalRequirement(publicTool, args = {}) {
  const entry = getCatalogAction(publicTool, args);
  return entry?.approval ? entry.approval(args) : null;
}

export {
  ACTION_OPERATIONS,
  OPERATION_CAPABILITIES,
  TOOL_SURFACE_VERSION,
  catalogApprovalRequirement,
  getCatalogAction,
  getCatalogToolDefinition,
  getCatalogToolDefinitions,
  getCatalogTools,
  getToolActionCatalog
};
