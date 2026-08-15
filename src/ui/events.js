// Dashboard SSE connection state and typed event delivery.
let _es = null;
let _sourceListeners = [];
let _onEvent = null;
let _onState = null;
let _tokenFn = null;
let _reconnectTimer = null;
let _stopped = true;
let _visibilityWired = false;
let _generation = 0;
let _retryCount = 0;

const LIVE_EVENT_TYPES = Object.freeze([
  'dashboard.bootstrap',
  'task.updated',
  'connection.updated',
  'workspace.updated',
  'process.updated'
]);

export function initEvents(onEvent, onState) {
  _onEvent = onEvent || null;
  _onState = onState || null;
  if (_visibilityWired) return;
  _visibilityWired = true;
  document.addEventListener('visibilitychange', _handleVisibilityChange);
}

export function startSSE(tokenFn) {
  _tokenFn = tokenFn || _tokenFn;
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
  const query = params.toString();
  const url = query ? `/events?${query}` : '/events';
  emitState(_retryCount ? 'reconnecting' : 'connecting');
  const source = new EventSource(url, { withCredentials: true });
  _es = source;

  listenSource(source, 'open', () => markLive(source, generation));
  listenSource(source, 'ready', event => {
    if (!isCurrent(source, generation)) return;
    markLive(source, generation);
    const payload = parseEventData(event);
    if (payload?.generatedAt) emitState('live', { lastEventAt: Date.parse(payload.generatedAt) || Date.now() });
  });
  for (const type of LIVE_EVENT_TYPES) {
    listenSource(source, type, event => {
      if (!isCurrent(source, generation)) return;
      const data = parseEventData(event);
      if (!data) return;
      markLive(source, generation, Date.now());
      _onEvent?.({ type, data });
    });
  }
  listenSource(source, 'error', () => {
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

function listenSource(source, type, handler) {
  source.addEventListener(type, handler);
  _sourceListeners.push({ source, type, handler });
}

function parseEventData(event) {
  try {
    return JSON.parse(event?.data || '{}');
  } catch (error) {
    debugError(error);
    return null;
  }
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
  const source = _es;
  for (const listener of _sourceListeners) {
    if (listener.source === source) listener.source.removeEventListener(listener.type, listener.handler);
  }
  _sourceListeners = _sourceListeners.filter(listener => listener.source !== source);
  source.close();
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
