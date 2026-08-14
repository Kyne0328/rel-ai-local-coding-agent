// @ts-check

import { publicEditInputSchema, publicExecInputSchema } from './publicOperationSchemas.js';
import { MAX_BATCH_EDITS } from '../editLimits.js';
import { outputSchemaFor } from './outputSchemas.js';
import { OPERATION_DEFINITION_VALUES } from './operationDefinitionValues.js';

/** @typedef {import('../../types/boundaries.d.ts').ToolDefinitionMetadata} ToolDefinitionMetadata */
/** @typedef {Omit<ToolDefinitionMetadata, 'annotations' | 'connectorStrip' | 'groups' | 'behavior' | 'dashboard' | 'outputSchema'> & { annotations?: Partial<ToolDefinitionMetadata['annotations']>, connectorStrip?: string[], groups?: import('../../types/boundaries.d.ts').ToolGroup[], behavior?: Partial<ToolDefinitionMetadata['behavior']>, dashboard?: Partial<ToolDefinitionMetadata['dashboard']>, outputSchema?: import('../../types/boundaries.d.ts').JsonSchema }} ToolDefinitionInput */



const READ_ONLY_TOOLS = new Set([
  'relai_repo_snapshot', 'relai_read', 'relai_search', 'relai_code_inspect', 'relai_semantic_search',
  'relai_process_read', 'relai_process_list',
  'relai_tidy_plan', 'relai_http_probe', 'relai_diff', 'relai_status', 'relai_git_draft_pr'
]);
const DESTRUCTIVE_TOOLS = new Set([
  'relai_exec', 'relai_process_start', 'relai_process_write', 'relai_process_stop',
  'relai_ui',
  'relai_diagnostics_run', 'relai_tidy_run', 'relai_run_checks',
  'relai_restore_paths', 'relai_reset_workspace', 'relai_edit'
]);
const IDEMPOTENT_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  'relai_process_stop', 'relai_restore_paths', 'relai_reset_workspace',
  'relai_cancel_work', 'relai_finish_work'
]);
const OPEN_WORLD_TOOLS = new Set([
  'relai_exec', 'relai_process_start', 'relai_process_write',
  'relai_ui',
  'relai_diagnostics_run', 'relai_run_checks', 'relai_git_push'
]);
const NATIVE_TASK_ELIGIBLE_TOOLS = new Set();

const PERSISTENT_PROCESS_TOOLS = new Set([
  'relai_process_start', 'relai_process_read', 'relai_process_write', 'relai_process_stop', 'relai_process_list'
]);
const ALWAYS_IMMEDIATE_TOOLS = new Set([
  'relai_begin_work', 'relai_repo_snapshot', 'relai_read', 'relai_search',
  'relai_status', 'relai_cancel_work', 'relai_finish_work'
]);

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

const DEFAULT_BEHAVIOR = Object.freeze({
  audit: '', cache: '', startsSession: false, deferStagedSession: false, sessionWrite: false, summary: '', longRunning: false,
  taskScope: 'required', concurrencyScope: 'task', executionClass: 'bounded_synchronous'
});
const DEFAULT_DASHBOARD = Object.freeze({
  category: 'Workspace tools', requiredProfile: 'workspace', requiresApproval: false
});

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
const OPERATION_DEFINITION_BY_NAME = new Map(OPERATION_DEFINITIONS.map((definition) => [definition.name, definition]));

/** @param {string} name @returns {ToolDefinitionMetadata | null} */
function getOperationDefinition(name) {
  return OPERATION_DEFINITION_BY_NAME.get(String(name || '')) || null;
}

/** @returns {readonly ToolDefinitionMetadata[]} */
function getOperationDefinitions() {
  return OPERATION_DEFINITIONS;
}


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
    dashboard: { category: 'Workflow', capabilities: ['workflow'] }
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
        action: ACTION(['symbol', 'references', 'related', 'impact', 'trace', 'diagnostics', 'architecture']),
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
        branch('diagnostics', [], ['symbol', 'query', 'paths', 'maxResults', 'maxDepth']),
        branch('architecture', [], ['symbol', 'query', 'paths', 'maxDepth'])
      ],
      additionalProperties: false
    },
    annotations: annotations(true, false, true, false),
    groups: ['audit']
  }),
  clonePublicEditOperation(),
  clonePublicExecOperation(),
  define({
    name: 'relai_process',
    title: 'Manage Process',
    description: 'Manage persistent services, watchers, and interactive programs. Prefer executable + argv; use relai_exec or relai_validate for one-shot work.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['start', 'read', 'write', 'stop', 'list']),
        command: { type: 'string', minLength: 1, maxLength: 20000, description: 'Shell command string for start. Use only when shell syntax is deliberately required.' },
        executable: { type: 'string', minLength: 1, maxLength: 1000, description: 'Executable to launch directly with shell:false. Preferred for persistent process startup.' },
        argv: { type: 'array', items: { type: 'string', maxLength: 20000 }, maxItems: 100, description: 'Literal arguments passed directly to executable without shell parsing.' },
        cwd: STRING,
        env: { type: 'object', additionalProperties: STRING },
        label: { type: 'string', maxLength: 120 },
        kind: { type: 'string', enum: ['service', 'watcher', 'interactive'] },
        purpose: { type: 'string', minLength: 1, maxLength: 300 },
        reuseExisting: { type: 'boolean' },
        startupWaitMs: { type: 'number', minimum: 0, maximum: 30000 },
        maxLogBytes: { type: 'number', minimum: 65536, maximum: 268435456 },
        processId: { type: 'string', minLength: 1, maxLength: 200 },
        stdoutOffset: { type: 'number', minimum: 0 },
        stderrOffset: { type: 'number', minimum: 0 },
        maxBytes: { type: 'number', minimum: 1000, maximum: 1048576 },
        includeMetadata: { type: 'boolean' },
        metadataRevision: { type: 'string', minLength: 1, maxLength: 100 },
        input: { type: 'string', maxLength: 1048576, description: 'For direct start, optional initial UTF-8 stdin written without closing the persistent stdin stream. For write, UTF-8 input sent to the running process.' },
        graceMs: { type: 'number', minimum: 0, maximum: 30000 },
        status: { type: 'string', enum: ['starting', 'running', 'stopping', 'exited', 'failed', 'stopped', 'orphaned'] },
        activeOnly: { type: 'boolean' },
        includeTerminal: { type: 'boolean' },
        limit: { type: 'number', minimum: 1, maximum: 500 }
      },
      required: ['action'],
      oneOf: [
        branch(
          'start',
          ['kind', 'purpose'],
          ['processId', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'graceMs', 'status', 'activeOnly', 'includeTerminal', 'limit'],
          {},
          {
            oneOf: [
              { required: ['command'], not: { anyOf: [{ required: ['executable'] }, { required: ['argv'] }, { required: ['input'] }] } },
              { required: ['executable'], not: { required: ['command'] } }
            ]
          }
        ),
        branch('read', ['processId'], ['command', 'executable', 'argv', 'cwd', 'env', 'label', 'kind', 'purpose', 'reuseExisting', 'startupWaitMs', 'maxLogBytes', 'input', 'graceMs', 'status', 'activeOnly', 'includeTerminal', 'limit']),
        branch('write', ['processId', 'input'], ['command', 'executable', 'argv', 'cwd', 'env', 'label', 'kind', 'purpose', 'reuseExisting', 'startupWaitMs', 'maxLogBytes', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'graceMs', 'status', 'activeOnly', 'includeTerminal', 'limit']),
        branch('stop', ['processId'], ['command', 'executable', 'argv', 'cwd', 'env', 'label', 'kind', 'purpose', 'reuseExisting', 'startupWaitMs', 'maxLogBytes', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'input', 'status', 'activeOnly', 'includeTerminal', 'limit']),
        branch('list', [], ['command', 'executable', 'argv', 'cwd', 'env', 'label', 'kind', 'purpose', 'reuseExisting', 'startupWaitMs', 'maxLogBytes', 'processId', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'input', 'graceMs'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, true, false, true),
    dashboard: { capabilities: ['execute'] },
    behavior: { executionClass: 'persistent_process' }
  }),
  define({
    name: 'relai_ui',
    title: 'Test Local UI',
    description: 'Inspect and interact with a workspace-scoped local UI test session.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['start', 'navigate', 'snapshot', 'interact', 'screenshot', 'console', 'network', 'viewport', 'reload', 'stop']),
        sessionId: { type: 'string', pattern: '^ui_[A-Za-z0-9_-]{20,160}$' },
        port: { type: 'number', minimum: 1, maximum: 65535 },
        host: { type: 'string', enum: ['localhost', '127.0.0.1', '::1', '[::1]'] },
        protocol: { type: 'string', enum: ['http', 'https'] },
        route: { type: 'string', minLength: 1, maxLength: 4000 },
        allowedPorts: { type: 'array', items: { type: 'number', minimum: 1, maximum: 65535 }, maxItems: 10 },
        headless: { type: 'boolean' },
        width: { type: 'number', minimum: 320, maximum: 3840 },
        height: { type: 'number', minimum: 240, maximum: 2160 },
        timeoutMs: { type: 'number', minimum: 100, maximum: 30000 },
        interaction: { type: 'string', enum: ['click', 'fill', 'press', 'select', 'hover', 'wait'] },
        target: {
          type: 'object',
          properties: {
            by: { type: 'string', enum: ['role', 'text', 'label', 'placeholder', 'testid', 'css'] },
            value: { type: 'string', minLength: 1, maxLength: 4000 },
            name: { type: 'string', maxLength: 1000 },
            exact: { type: 'boolean' },
            index: { type: 'number', minimum: 0, maximum: 1000 }
          },
          required: ['by', 'value'],
          additionalProperties: false
        },
        input: { type: 'string', maxLength: 1048576 },
        key: { type: 'string', maxLength: 100 },
        selectValue: { type: 'string', maxLength: 10000 },
        state: { type: 'string', enum: ['visible', 'hidden', 'attached', 'detached'] },
        fullPage: { type: 'boolean' },
        maxEntries: { type: 'number', minimum: 1, maximum: 200 },
        clear: { type: 'boolean' }
      },
      required: ['action'],
      oneOf: [
        branch('start', ['port'], ['sessionId', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear']),
        branch('navigate', ['sessionId', 'route'], ['port', 'host', 'protocol', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear']),
        branch('snapshot', ['sessionId'], ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear']),
        branch('interact', ['sessionId', 'interaction', 'target'], ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'fullPage', 'maxEntries', 'clear']),
        branch('screenshot', ['sessionId'], ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'maxEntries', 'clear']),
        branch('console', ['sessionId'], ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage']),
        branch('network', ['sessionId'], ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage']),
        branch('viewport', ['sessionId', 'width', 'height'], ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear']),
        branch('reload', ['sessionId'], ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear']),
        branch('stop', ['sessionId'], ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'timeoutMs', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, true, false, true),
    dashboard: { capabilities: ['execute'] }
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
    behavior: { longRunning: true },
    dashboard: { capabilities: ['validate'] }
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
        branch('restore', ['paths'], ['staged', 'path', 'redactSensitive', 'scope', 'maxBytes', 'confirmation', 'removeUntracked', 'mode', 'maxCandidates', 'planId']),
        branch('reset', ['confirmation'], ['staged', 'path', 'redactSensitive', 'scope', 'maxBytes', 'paths', 'mode', 'maxCandidates', 'planId']),
        branch('tidy_plan', [], ['staged', 'path', 'redactSensitive', 'scope', 'maxBytes', 'paths', 'confirmation', 'removeUntracked', 'planId']),
        branch('tidy_run', ['planId'], ['staged', 'path', 'redactSensitive', 'scope', 'maxBytes', 'paths', 'confirmation', 'removeUntracked', 'mode', 'maxCandidates'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, true, false, false),
    dashboard: { capabilities: ['review', 'recover'] },
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
    dashboard: { capabilities: ['git'] },
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

function cloneOperation(sourceName, name, title, description, overrides = {}) {
  const source = getOperationDefinition(sourceName);
  if (!source) throw new Error(`Missing internal operation definition: ${sourceName}`);
  return define({
    ...source,
    ...overrides,
    name,
    title,
    description,
    outputSchema: RESULT_SCHEMA,
    handlerName: 'compactDispatch'
  });
}

function clonePublicExecOperation() {
  const source = getOperationDefinition('relai_exec');
  if (!source) throw new Error('Missing internal operation definition: relai_exec');
  return cloneOperation(
    'relai_exec',
    'relai_exec',
    'Run Command',
    'Run one-shot workspace commands. Prefer executable + argv for direct invocation; use command only when command-line syntax is required.',
    {
      inputSchema: publicExecInputSchema(source.inputSchema),
      dashboard: { capabilities: ['execute'] }
    }
  );
}

function clonePublicEditOperation() {
  const source = getOperationDefinition('relai_edit');
  if (!source) throw new Error('Missing internal operation definition: relai_edit');
  return cloneOperation('relai_edit', 'relai_edit', 'Edit Repository', 'Edit with oldText/newText, content for full-file replacement, batches, or patch text. Keep large repository-wide changes in one logical updateText patch.', {
    inputSchema: publicEditInputSchema(source.inputSchema, MAX_BATCH_EDITS),
    dashboard: { capabilities: ['edit'] }
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
  const dashboardMetadata = {
    category: 'Workspace tools',
    requiredProfile: 'workspace',
    requiresApproval: false,
    capabilities: ['inspect'],
    ...(dashboard || {})
  };
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
    dashboard: Object.freeze({
      ...dashboardMetadata,
      capabilities: Object.freeze([...dashboardMetadata.capabilities])
    }),
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

export {
  getCatalogToolDefinition,
  getCatalogToolDefinitions,
  getOperationDefinition,
  getOperationDefinitions
};
