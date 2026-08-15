// @ts-check

import { z } from 'zod';

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

const INSPECT_FIELDS = Object.freeze({
  symbol: contract({ required: ['symbol'], omit: ['query', 'paths', 'maxDepth'] }),
  references: contract({ required: ['symbol'], omit: ['query', 'paths', 'maxDepth'] }),
  related: contract({ omit: ['paths', 'maxDepth'], extra: { anyOf: [{ required: ['query'] }, { required: ['symbol'] }] } }),
  impact: contract({ omit: ['query'], extra: { anyOf: [{ required: ['symbol'] }, { required: ['paths'] }] } }),
  trace: contract({ required: ['symbol'], omit: ['query', 'paths'] }),
  diagnostics: contract({ omit: ['symbol', 'query', 'paths', 'maxResults', 'maxDepth'] }),
  architecture: contract({ omit: ['symbol', 'query', 'paths', 'maxDepth'] })
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

const ACTION_REGISTRY = Object.freeze({
  relai_work: Object.freeze({
    begin: operation('relai_begin_work', { capability: READ }),
    status: operation('relai_status', { capability: READ }),
    finish: operation('relai_finish_work', { capability: READ }),
    cancel: operation('relai_cancel_work', { capability: READ })
  }),
  relai_snapshot: Object.freeze({ default: operation('relai_repo_snapshot', { capability: READ }) }),
  relai_read: Object.freeze({ default: operation('relai_read', { capability: READ }) }),
  relai_search: Object.freeze({
    text: operation('relai_search', { capability: READ }),
    semantic: operation('relai_semantic_search', { capability: READ })
  }),
  relai_inspect: Object.freeze(Object.fromEntries(Object.entries(INSPECT_FIELDS).map(([action, publicContract]) => [
    action,
    operation('relai_code_inspect', { capability: READ, keepAction: true, publicContract })
  ]))),
  relai_edit: Object.freeze({ default: operation('relai_edit', { capability: WRITE }) }),
  relai_exec: Object.freeze({ default: operation('relai_exec', { capability: EXECUTE }) }),
  relai_process: Object.freeze({
    start: operation('relai_process_start', { capability: PROCESS }),
    read: operation('relai_process_read', { capability: READ }),
    write: operation('relai_process_write', { capability: PROCESS }),
    stop: operation('relai_process_stop', { capability: PROCESS }),
    list: operation('relai_process_list', { capability: READ })
  }),
  relai_ui: Object.freeze({
    start: operation('relai_ui', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['port'], omit: UI_OMIT.start }) }),
    navigate: operation('relai_ui', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId', 'route'], omit: UI_OMIT.navigate }) }),
    snapshot: operation('relai_ui', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.snapshot }) }),
    interact: operation('relai_ui', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId', 'interaction', 'target'], omit: UI_OMIT.interact }) }),
    screenshot: operation('relai_ui', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.screenshot }) }),
    console: operation('relai_ui', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.console }) }),
    network: operation('relai_ui', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.network }) }),
    viewport: operation('relai_ui', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId', 'width', 'height'], omit: UI_OMIT.viewport }) }),
    reload: operation('relai_ui', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.reload }) }),
    stop: operation('relai_ui', { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.stop }) })
  }),
  relai_validate: Object.freeze({
    checks: operation('relai_run_checks', { capability: EXECUTE }),
    diagnostics: operation('relai_diagnostics_run', { capability: EXECUTE }),
    http: operation('relai_http_probe', { capability: READ })
  }),
  relai_changes: Object.freeze({
    diff: operation('relai_diff', { capability: READ }),
    restore: operation('relai_restore_paths', { capability: WRITE }),
    reset: operation('relai_reset_workspace', {
      capability: WRITE,
      approval: args => ({ message: `Discard workspace changes using ${args.removeUntracked ? 'RESET_AND_CLEAN' : 'RESET'}?` })
    }),
    tidy_plan: operation('relai_tidy_plan', { capability: READ }),
    tidy_run: operation('relai_tidy_run', { capability: WRITE })
  }),
  relai_publish: Object.freeze({
    commit: operation('relai_git_commit', {
      capability: WRITE,
      approval: args => (args.addAll === true || args.sensitiveAuthorization
        ? { message: `Create the requested Git commit${args.addAll ? ' including all current changes' : ''}?` }
        : null)
    }),
    push: operation('relai_git_push', {
      capability: PUBLISH,
      approval: args => ({ message: `Publish branch ${args.branch || '(current branch)'} to ${args.remote || 'origin'}?` })
    }),
    draft_pr: operation('relai_git_draft_pr', { capability: READ })
  })
});

/** @param {Record<string, any>} [value] */
function contract(value = {}) {
  const parsed = PUBLIC_CONTRACT_SCHEMA.parse(value);
  return Object.freeze({
    required: Object.freeze([...parsed.required]),
    omit: Object.freeze([...parsed.omit]),
    extra: Object.freeze({ ...parsed.extra })
  });
}

/** @param {string} operationName @param {Record<string, any>} [options] */
function operation(operationName, options = {}) {
  return Object.freeze({
    operationName,
    keepAction: options.keepAction === true,
    capability: String(options.capability || ''),
    approval: typeof options.approval === 'function' ? options.approval : null,
    publicContract: options.publicContract || null
  });
}

export { ACTION_REGISTRY };
