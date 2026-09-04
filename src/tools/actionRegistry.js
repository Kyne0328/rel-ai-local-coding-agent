// @ts-check

import { z } from 'zod';
import { OPERATION_DEFINITION_VALUES } from './operationDefinitionValues.js';
import { OPERATION_IDS as OP } from './operationIds.js';

const PUBLIC_CONTRACT_SCHEMA = z.object({
  required: z.array(z.string()).default([]),
  omit: z.array(z.string()).default([]),
  extra: z.record(z.string(), z.unknown()).default({})
}).strict();

const READ = 'repository:read';
const WRITE = 'repository:write';
const EXECUTE = 'command:execute';
const PROCESS = 'process:manage';
const PUBLISH = 'git:publish';

const INSPECT_LOCATION_OR_SYMBOL = Object.freeze({
  anyOf: [
    { required: ['symbol'] },
    { required: ['path', 'line', 'column'] }
  ]
});

const INSPECT_FIELDS = Object.freeze({
  symbol: contract({ required: ['symbol'], omit: ['query', 'paths', 'maxDepth', 'path', 'line', 'column'] }),
  definition: contract({ omit: ['query', 'paths', 'maxDepth'], extra: INSPECT_LOCATION_OR_SYMBOL }),
  references: contract({ omit: ['query', 'paths', 'maxDepth'], extra: INSPECT_LOCATION_OR_SYMBOL }),
  hover: contract({ omit: ['query', 'paths', 'maxDepth'], extra: INSPECT_LOCATION_OR_SYMBOL }),
  implementation: contract({ omit: ['query', 'paths', 'maxDepth'], extra: INSPECT_LOCATION_OR_SYMBOL }),
  related: contract({ omit: ['paths', 'maxDepth', 'path', 'line', 'column'], extra: { anyOf: [{ required: ['query'] }, { required: ['symbol'] }] } }),
  impact: contract({ omit: ['query', 'path', 'line', 'column'], extra: { anyOf: [{ required: ['symbol'] }, { required: ['paths'] }] } }),
  trace: contract({ required: ['symbol'], omit: ['query', 'paths', 'path', 'line', 'column'] }),
  diagnostics: contract({ omit: ['symbol', 'query', 'paths', 'maxResults', 'maxDepth', 'path', 'line', 'column'] }),
  architecture: contract({ omit: ['symbol', 'query', 'paths', 'maxDepth', 'path', 'line', 'column'] })
});

const UI_OMIT = Object.freeze({
  start: ['sessionId', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear'],
  navigate: ['port', 'host', 'protocol', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear'],
  snapshot: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear'],
  interact: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'fullPage', 'maxEntries', 'clear'],
  screenshot: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'maxEntries', 'clear'],
  console: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage'],
  network: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage'],
  viewport: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear'],
  reload: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear'],
  stop: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'timeoutMs', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear']
});

// One canonical operation registry owns the internal definition and every public
// exposure of that operation. Public action lookup is derived below rather than
// maintained as an independent source of truth.
const PUBLIC_BINDINGS_BY_OPERATION = Object.freeze({
  [OP.WORK_BEGIN]: [expose('relai_work', 'begin', { capability: READ })],
  [OP.WORK_STATUS]: [expose('relai_work', 'status', { capability: READ })],
  [OP.WORK_FINISH]: [expose('relai_work', 'finish', { capability: READ })],
  [OP.WORK_CANCEL]: [expose('relai_work', 'cancel', { capability: READ })],
  [OP.SNAPSHOT]: [expose('relai_snapshot', 'default', { capability: READ })],
  [OP.READ]: [expose('relai_read', 'default', { capability: READ })],
  [OP.SEARCH_TEXT]: [expose('relai_search', 'text', { capability: READ })],
  [OP.SEARCH_SEMANTIC]: [expose('relai_search', 'semantic', { capability: READ })],
  [OP.INSPECT]: Object.entries(INSPECT_FIELDS).map(([action, publicContract]) =>
    expose('relai_inspect', action, { capability: READ, keepAction: true, publicContract })),
  [OP.EDIT]: [expose('relai_edit', 'default', { capability: WRITE })],
  [OP.EXEC]: [expose('relai_exec', 'default', { capability: EXECUTE })],
  [OP.PROCESS_START]: [expose('relai_process', 'start', { capability: PROCESS })],
  [OP.PROCESS_READ]: [expose('relai_process', 'read', { capability: READ })],
  [OP.PROCESS_WRITE]: [expose('relai_process', 'write', { capability: PROCESS })],
  [OP.PROCESS_STOP]: [expose('relai_process', 'stop', { capability: PROCESS })],
  [OP.PROCESS_LIST]: [expose('relai_process', 'list', { capability: READ })],
  [OP.UI]: [
    expose('relai_ui', 'start', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['port'], omit: UI_OMIT.start }) }),
    expose('relai_ui', 'navigate', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId', 'route'], omit: UI_OMIT.navigate }) }),
    expose('relai_ui', 'snapshot', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.snapshot }) }),
    expose('relai_ui', 'interact', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId', 'interaction', 'target'], omit: UI_OMIT.interact }) }),
    expose('relai_ui', 'screenshot', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.screenshot }) }),
    expose('relai_ui', 'console', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.console }) }),
    expose('relai_ui', 'network', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.network }) }),
    expose('relai_ui', 'viewport', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId', 'width', 'height'], omit: UI_OMIT.viewport }) }),
    expose('relai_ui', 'reload', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.reload }) }),
    expose('relai_ui', 'stop', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.stop }) })
  ],
  [OP.VALIDATE_CHECKS]: [expose('relai_validate', 'checks', { capability: EXECUTE })],
  [OP.VALIDATE_DIAGNOSTICS]: [expose('relai_validate', 'diagnostics', { capability: EXECUTE })],
  [OP.VALIDATE_HTTP]: [expose('relai_validate', 'http', { capability: READ })],
  [OP.CHANGES_DIFF]: [expose('relai_changes', 'diff', { capability: READ })],
  [OP.CHANGES_CHECKPOINT]: [expose('relai_changes', 'checkpoint', { capability: READ })],
  [OP.CHANGES_REPLAY]: [expose('relai_changes', 'replay', { capability: READ })],
  [OP.CHANGES_RESTORE]: [expose('relai_changes', 'restore', { capability: WRITE })],
  [OP.CHANGES_RESET]: [expose('relai_changes', 'reset', {
    capability: WRITE,
    approval: args => ({ message: `Discard workspace changes using ${args.removeUntracked ? 'RESET_AND_CLEAN' : 'RESET'}?` })
  })],
  [OP.CHANGES_TIDY_PLAN]: [expose('relai_changes', 'tidy_plan', { capability: READ })],
  [OP.CHANGES_TIDY_RUN]: [expose('relai_changes', 'tidy_run', { capability: WRITE })],
  [OP.PUBLISH_COMMIT]: [expose('relai_publish', 'commit', {
    capability: WRITE
  })],
  [OP.PUBLISH_PUSH]: [expose('relai_publish', 'push', {
    capability: PUBLISH,
    approval: args => args.dryRun === true
      ? null
      : ({ message: `Publish branch ${args.branch || '(current branch)'} to ${args.remote || 'origin'}?` })
  })],
  [OP.PUBLISH_DRAFT_PR]: [expose('relai_publish', 'draft_pr', { capability: READ })]
});

const OPERATION_REGISTRY = buildOperationRegistry(OPERATION_DEFINITION_VALUES, PUBLIC_BINDINGS_BY_OPERATION);
const ACTION_REGISTRY = buildActionRegistry(PUBLIC_BINDINGS_BY_OPERATION);

/** @param {Record<string, any>} [value] */
function contract(value = {}) {
  const parsed = PUBLIC_CONTRACT_SCHEMA.parse(value);
  return Object.freeze({
    required: Object.freeze([...parsed.required]),
    omit: Object.freeze([...parsed.omit]),
    extra: Object.freeze({ ...parsed.extra })
  });
}

/** @param {string} publicName @param {string} action @param {Record<string, any>} [options] */
function expose(publicName, action, options = {}) {
  return Object.freeze({
    publicName,
    action,
    keepAction: options.keepAction === true,
    capability: String(options.capability || ''),
    approval: typeof options.approval === 'function' ? options.approval : null,
    publicContract: options.publicContract || null
  });
}

function buildOperationRegistry(definitions, bindingsByOperation) {
  const definitionNames = new Set(definitions.map(definition => definition.name));
  for (const operationName of Object.keys(bindingsByOperation)) {
    if (!definitionNames.has(operationName)) {
      throw new Error(`Public binding references unknown operation '${operationName}'.`);
    }
  }
  return Object.freeze(definitions.map(definition => {
    const publicActions = bindingsByOperation[definition.name] || [];
    if (publicActions.length === 0) {
      throw new Error(`Operation '${definition.name}' has no public tool/action binding.`);
    }
    return Object.freeze({
      definition: Object.freeze({ ...definition }),
      publicActions: Object.freeze([...publicActions])
    });
  }));
}

function buildActionRegistry(bindingsByOperation) {
  const tools = new Map();
  for (const [operationName, publicActions] of Object.entries(bindingsByOperation)) {
    for (const exposure of publicActions) {
      if (!tools.has(exposure.publicName)) tools.set(exposure.publicName, new Map());
      const actions = tools.get(exposure.publicName);
      if (actions.has(exposure.action)) {
        throw new Error(`Duplicate public binding '${exposure.publicName}:${exposure.action}'.`);
      }
      actions.set(exposure.action, Object.freeze({
        operationName,
        keepAction: exposure.keepAction,
        capability: exposure.capability,
        approval: exposure.approval,
        publicContract: exposure.publicContract
      }));
    }
  }
  return Object.freeze(Object.fromEntries([...tools].map(([publicName, actions]) => [
    publicName,
    Object.freeze(Object.fromEntries(actions))
  ])));
}

function isToolSurfaceSourcePath(value) {
  const normalized = String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
  return normalized.startsWith('src/tools/');
}

export { ACTION_REGISTRY, OPERATION_REGISTRY, isToolSurfaceSourcePath };
