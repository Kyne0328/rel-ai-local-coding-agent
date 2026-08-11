// Dashboard SSE connection state and event delivery.
let _es = null;
let _onEvent = null;
let _onState = null;
let _tokenFn = null;
let _snapshotRevision = '';
let _reconnectTimer = null;
let _stopped = true;
let _visibilityWired = false;
let _generation = 0;
let _retryCount = 0;

export function initEvents(onEvent, onState) {
  _onEvent = onEvent || null;
  _onState = onState || null;
  if (_visibilityWired) return;
  _visibilityWired = true;
  document.addEventListener('visibilitychange', _handleVisibilityChange);
}

export function startSSE(tokenFn, snapshotRevision = '') {
  _tokenFn = tokenFn || _tokenFn;
  _snapshotRevision = String(snapshotRevision || _snapshotRevision || '');
  _stopped = false;
  if (_es) return;
  _connect();
}

export function stopSSE(options = {}) {
  _stopped = true;
  _generation += 1;
  closeSource();
  clearReconnect();
  if (options.emit !== false) emitState('offline');
}

export function restartSSE(tokenFn) {
  _tokenFn = tokenFn || _tokenFn;
  stopSSE({ emit: false });
  _stopped = false;
  _retryCount = 0;
  _connect();
}

export function isLive() {
  return _es !== null && _es.readyState === EventSource.OPEN;
}

function _handleVisibilityChange() {
  if (document.visibilityState !== 'visible' || _stopped || _es) return;
  _retryCount = 0;
  _connect();
}

function _connect() {
  if (_stopped || _es) return;
  const generation = ++_generation;
  const token = _tokenFn ? _tokenFn() : '';
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (_snapshotRevision) params.set('revision', _snapshotRevision);
  const query = params.toString();
  const url = query ? `/events?${query}` : '/events';
  emitState(_retryCount ? 'reconnecting' : 'connecting');
  const source = new EventSource(url, { withCredentials: true });
  _es = source;

  source.addEventListener('open', () => markLive(source, generation));
  source.addEventListener('ready', event => {
    if (!isCurrent(source, generation)) return;
    markLive(source, generation);
    try {
      const payload = JSON.parse(event.data || '{}');
      if (payload.generatedAt) emitState('live', { lastEventAt: Date.parse(payload.generatedAt) || Date.now() });
    } catch (error) {
      debugError(error);
    }
  });
  source.addEventListener('dashboard', event => {
    if (!isCurrent(source, generation)) return;
    try {
      const data = JSON.parse(event.data);
      if (data?.snapshot?.revision) _snapshotRevision = String(data.snapshot.revision);
      markLive(source, generation, Date.now());
      _onEvent?.(data);
    } catch (error) {
      debugError(error);
    }
  });
  source.addEventListener('error', () => {
    if (!isCurrent(source, generation)) return;
    closeSource();
    if (_stopped) return;
    _retryCount += 1;
    emitState('reconnecting');
    const delay = Math.min(15000, 750 * (2 ** Math.min(_retryCount - 1, 4)));
    clearReconnect();
    _reconnectTimer = window.setTimeout(() => {
      _reconnectTimer = null;
      _connect();
    }, delay);
  });
}

function markLive(source, generation, lastEventAt = 0) {
  if (!isCurrent(source, generation)) return;
  _retryCount = 0;
  emitState('live', lastEventAt ? { lastEventAt } : {});
}

function isCurrent(source, generation) {
  return source === _es && generation === _generation;
}

function closeSource() {
  if (!_es) return;
  _es.close();
  _es = null;
}

function clearReconnect() {
  if (!_reconnectTimer) return;
  clearTimeout(_reconnectTimer);
  _reconnectTimer = null;
}

function emitState(state, detail = {}) {
  _onState?.({ state, ...detail });
}

function debugError(error) {
  if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
}
