// SSE manager with auto-reconnect and visibility-pause
import { set } from '/ui/store.js';

let _es = null;
let _paused = false;
let _onEvent = null;
let _reconnectTimer = null;

export function initEvents(onEvent) {
  _onEvent = onEvent || null;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      _pause();
    } else {
      _resume();
    }
  });
}

export function startSSE(tokenFn) {
  if (_es) return;
  _connect(tokenFn);
}

export function stopSSE() {
  if (_es) { _es.close(); _es = null; }
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
}

export function isLive() { return _es !== null; }

function _connect(tokenFn) {
  const token = tokenFn ? tokenFn() : '';
  const url = token ? `/events?token=${encodeURIComponent(token)}` : '/events';
  _es = new EventSource(url);

  _es.addEventListener('dashboard', (e) => {
    if (_paused) return;
    try {
      const data = JSON.parse(e.data);
      set({ payload: data });
      if (_onEvent) _onEvent(data);
    } catch (_) {}
  });

  _es.addEventListener('error', () => {
    stopSSE();
    // Reconnect after 5 s
    _reconnectTimer = setTimeout(() => _connect(tokenFn), 5000);
  });
}

function _pause() { _paused = true; }
function _resume() {
  _paused = false;
}
