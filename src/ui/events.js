// Dashboard SSE connection state and event delivery.
let _es = null;
let _onEvent = null;
let _onState = null;
let _tokenFn = null;
let _reconnectTimer = null;
let _paused = false;
let _visibilityWired = false;

export function initEvents(onEvent, onState) {
  _onEvent = onEvent || null;
  _onState = onState || null;
  if (_visibilityWired) return;
  _visibilityWired = true;
  document.addEventListener('visibilitychange', _handleVisibilityChange);
}

export function startSSE(tokenFn) {
  _tokenFn = tokenFn || _tokenFn;
  if (_es || document.visibilityState === 'hidden') return;
  _connect();
}

export function stopSSE() {
  if (_es) { _es.close(); _es = null; }
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  emitState('stopped');
}

export function restartSSE(tokenFn) {
  stopSSE();
  _paused = false;
  startSSE(tokenFn || _tokenFn);
}

export function isLive() { return _es !== null && _es.readyState === EventSource.OPEN; }

function _handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    _paused = true;
    if (_es) { _es.close(); _es = null; }
    emitState('paused');
  } else {
    _paused = false;
    startSSE(_tokenFn);
  }
}

function _connect() {
  const token = _tokenFn ? _tokenFn() : '';
  const url = token ? `/events?token=${encodeURIComponent(token)}` : '/events';
  emitState('connecting');
  _es = new EventSource(url);
  _es.addEventListener('open', () => emitState('live'));
  _es.addEventListener('dashboard', event => {
    if (_paused) return;
    try {
      const data = JSON.parse(event.data);
      emitState('live', { lastEventAt: Date.now() });
      _onEvent?.(data);
    } catch (error) {
      if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
    }
  });
  _es.addEventListener('error', () => {
    if (_es) { _es.close(); _es = null; }
    if (_reconnectTimer) clearTimeout(_reconnectTimer);
    if (!_paused && document.visibilityState !== 'hidden') {
      emitState('reconnecting');
      _reconnectTimer = setTimeout(() => {
        _reconnectTimer = null;
        _connect();
      }, 5000);
    }
  });
}

function emitState(state, detail = {}) {
  _onState?.({ state, ...detail });
}
