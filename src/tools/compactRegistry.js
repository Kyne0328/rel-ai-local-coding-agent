// @ts-check

import { MAX_BATCH_EDITS } from '../editLimits.js';
import { getToolDefinition as legacyDefinition } from './registry.js';

const TOOL_SURFACE_VERSION = 29;
const STRING = Object.freeze({ type: 'string' });
const WORKSPACE = Object.freeze({ type: 'string' });
const ACTION = values => ({ type: 'string', enum: values });
const RESULT_SCHEMA = Object.freeze({
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: true
});


const COMPACT_DEFINITION_VALUES = [
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
        branch('begin', ['workspace']),
        branch('status'),
        branch('finish', ['work_id', 'summary']),
        branch('cancel', ['work_id'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, false, false, false),
    behavior: { taskScope: 'optional', executionClass: 'always_immediate' },
    dashboard: { category: 'Workflow' }
  }),
  cloneLegacy('relai_repo_snapshot', 'relai_snapshot', 'Repository Snapshot', 'Map repository context.'),
  cloneLegacy('relai_read', 'relai_read', 'Read Repository', 'Read files, ranges, or directories.'),
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
      additionalProperties: false
    },
    annotations: annotations(true, false, true, false),
    groups: ['audit']
  }),
  cloneLegacy('relai_edit', 'relai_edit', 'Edit Repository', `Apply up to ${MAX_BATCH_EDITS} bounded repository edits.`),
  cloneLegacy('relai_exec', 'relai_exec', 'Run Command', 'Run a bounded command.'),
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
        startupWaitMs: { type: 'number', minimum: 0, maximum: 30000 },
        maxLogBytes: { type: 'number', minimum: 65536, maximum: 268435456 },
        processId: { type: 'string', minLength: 1, maxLength: 200 },
        stdoutOffset: { type: 'number', minimum: 0 },
        stderrOffset: { type: 'number', minimum: 0 },
        maxBytes: { type: 'number', minimum: 1000, maximum: 1048576 },
        input: { type: 'string', maxLength: 1048576 },
        graceMs: { type: 'number', minimum: 0, maximum: 30000 },
        status: { type: 'string', enum: ['starting', 'running', 'stopping', 'exited', 'failed', 'stopped', 'orphaned'] },
        limit: { type: 'number', minimum: 1, maximum: 500 }
      },
      required: ['action'],
      oneOf: [
        branch('start', ['command'], ['processId', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'input', 'graceMs', 'status', 'limit']),
        branch('read', ['processId'], ['command', 'cwd', 'env', 'label', 'startupWaitMs', 'maxLogBytes', 'input', 'graceMs', 'status', 'limit']),
        branch('write', ['processId', 'input'], ['command', 'cwd', 'env', 'label', 'startupWaitMs', 'maxLogBytes', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'graceMs', 'status', 'limit']),
        branch('stop', ['processId'], ['command', 'cwd', 'env', 'label', 'startupWaitMs', 'maxLogBytes', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'input', 'status', 'limit']),
        branch('list', [], ['command', 'cwd', 'env', 'label', 'startupWaitMs', 'maxLogBytes', 'processId', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'input', 'graceMs'])
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
        branch('draft_pr', [], ['message', 'dryRun', 'addAll', 'sensitiveAuthorization', 'paths', 'maxBytes', 'timeoutMs', 'remote', 'setUpstream'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, false, false, true),
    groups: ['git']
  })
];

const COMPACT_TOOL_DEFINITIONS = Object.freeze(COMPACT_DEFINITION_VALUES);
const COMPACT_BY_NAME = new Map(COMPACT_TOOL_DEFINITIONS.map(definition => [definition.name, definition]));

function branch(action, required = [], _irrelevant = [], properties = {}) {
  return {
    properties: { action: { const: action }, ...properties },
    required: ['action', ...required]
  };
}

function cloneLegacy(sourceName, name, title, description) {
  const source = legacyDefinition(sourceName);
  if (!source) throw new Error(`Missing legacy tool definition: ${sourceName}`);
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
  return Object.freeze({
    handlerName: 'compactDispatch',
    ...definition,
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

function getCompactToolDefinition(name) {
  return COMPACT_BY_NAME.get(String(name || '')) || null;
}

function getCompactToolDefinitions() {
  return COMPACT_TOOL_DEFINITIONS;
}

export { TOOL_SURFACE_VERSION, getCompactToolDefinition, getCompactToolDefinitions };
