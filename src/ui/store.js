// Canonical dashboard client state. Bootstrap replaces the whole state; typed
// domain deltas update only their owned projection and are ordered by revision.
let _state = {};
let _streamId = '';
let _revisions = emptyRevisions();

export function get() { return _state; }

export function init(initial) {
  const next = initial || {};
  const incomingLive = next.live || null;
  if (incomingLive) {
    _streamId = String(incomingLive.streamId || '');
    _revisions = { ...emptyRevisions(), ...(incomingLive.revisions || {}) };
  }
  _state = next;
  syncLiveMetadata();
}

export function applyLiveEvent(type, payload = {}) {
  if (type === 'dashboard.bootstrap') {
    init(payload);
    return { accepted: true, state: _state, domain: 'bootstrap' };
  }

  const domain = domainForEvent(type);
  if (!domain) return { accepted: false, state: _state, domain: '' };
  const streamId = String(payload.streamId || '');
  if (_streamId && streamId && streamId !== _streamId) return { accepted: false, state: _state, domain };
  if (!_streamId && streamId) _streamId = streamId;

  const revision = Math.max(0, Number(payload.revision || 0));
  if (revision <= Number(_revisions[domain] || 0)) return { accepted: false, state: _state, domain };
  _revisions[domain] = revision;

  if (type === 'task.updated') applyTaskDelta(payload);
  else if (type === 'connection.updated') applyConnectionDelta(payload);
  else if (type === 'workspace.updated') applyWorkspaceDelta(payload);
  else if (type === 'process.updated') _state.managedProcesses = Array.isArray(payload.managedProcesses) ? payload.managedProcesses : [];

  syncLiveMetadata();
  return { accepted: true, state: _state, domain };
}

function applyTaskDelta(payload) {
  if (payload.taskActivity) _state.taskActivity = payload.taskActivity;
  if (Array.isArray(payload.tasks)) _state.tasks = payload.tasks;
  if (payload.auditTail) _state.auditTail = payload.auditTail;
  if (payload.workspaceStates) {
    _state.workspaceStates = payload.workspaceStates;
    syncWorkspaceOperationalStates(payload.workspaceStates);
  }
}

function applyConnectionDelta(payload) {
  for (const key of ['connection', 'connectionState', 'mcpConnection', 'mcpAuthentication', 'desktopStatus']) {
    if (payload[key] !== undefined) _state[key] = payload[key];
  }
}

function applyWorkspaceDelta(payload) {
  const alias = String(payload.alias || '');
  if (!alias || !payload.state) return;
  const current = _state.workspaceStates?.[alias] || {};
  const merged = { ...current, ...payload.state };
  _state.workspaceStates = { ...(_state.workspaceStates || {}), [alias]: merged };
  syncWorkspaceOperationalStates({ [alias]: merged });
}

function syncWorkspaceOperationalStates(states) {
  if (!Array.isArray(_state.config?.workspaces)) return;
  _state.config.workspaces = _state.config.workspaces.map(workspace => (
    states[workspace.alias]
      ? { ...workspace, operational: states[workspace.alias] }
      : workspace
  ));
}

function syncLiveMetadata() {
  _state.live = {
    ...(_state.live || {}),
    streamId: _streamId,
    revisions: { ..._revisions }
  };
}

function domainForEvent(type) {
  if (type === 'task.updated') return 'task';
  if (type === 'connection.updated') return 'connection';
  if (type === 'workspace.updated') return 'workspace';
  if (type === 'process.updated') return 'process';
  return '';
}

function emptyRevisions() {
  return { task: 0, connection: 0, workspace: 0, process: 0, config: 0, analytics: 0 };
}
