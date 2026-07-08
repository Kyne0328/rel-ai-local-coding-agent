// Dashboard event stream. The dashboard connects automatically; the server only
// emits a dashboard event when MCP/audit/config state changes. There is no UI
// start/stop mode and no background polling that re-mounts pages.

let _es = null;
let _onEvent = null;
let _tokenFn = null;
let _reconnectTimer = null;
let _paused = false;
let _visibilityWired = false;

export function initEvents(onEvent) {
  _onEvent = onEvent || null;
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
}

export function isLive() { return _es !== null; }

function _handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    _paused = true;
    stopSSE();
  } else {
    _paused = false;
    startSSE(_tokenFn);
  }
}

function _connect() {
  const token = _tokenFn ? _tokenFn() : '';
  const url = token ? `/events?token=${encodeURIComponent(token)}` : '/events';
  _es = new EventSource(url);

  _es.addEventListener('dashboard', (e) => {
    if (_paused) return;
    try {
      const data = JSON.parse(e.data);
      if (_onEvent) _onEvent(data);
    } catch (error) { if (window.localStorage?.getItem('relai_debug') === '1') console.error(error); }
  });

  _es.addEventListener('error', () => {
    if (_es) { _es.close(); _es = null; }
    if (_reconnectTimer) clearTimeout(_reconnectTimer);
    if (!_paused && document.visibilityState !== 'hidden') {
      _reconnectTimer = setTimeout(() => {
        _reconnectTimer = null;
        _connect();
      }, 5000);
    }
  });
}
