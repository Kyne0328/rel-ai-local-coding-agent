// SSE manager with auto-reconnect and visibility-pause
import { set } from '/ui/store.js';

let _es = null;
let _paused = false;
let _onEvent = null;
let _reconnectTimer = null;
let _pollTimer = null;
let _pollCallback = null;
let _visibilityWired = false;
// Fallback poll cadence (ms) used only when SSE is down. Configurable from
// productUx.dashboardRefreshSeconds via setPollInterval(); 15s default.
let _pollInterval = 15000;

export function setPollCallback(fn) {
  _pollCallback = fn;
}

export function setPollInterval(ms) {
  const n = Number(ms);
  if (Number.isFinite(n) && n > 0) _pollInterval = Math.min(Math.max(n, 2000), 120000);
}

export function initEvents(onEvent) {
  _onEvent = onEvent || null;
  if (_visibilityWired) return;
  _visibilityWired = true;

  document.addEventListener('visibilitychange', _handleVisibilityChange);
}

function _handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    _pause();
    _stopPoll();
  } else {
    _resume();
    if (!_es && _pollCallback) _startPoll(_pollCallback);
  }
}

export function startSSE(tokenFn) {
  if (_es) return;
  _connect(tokenFn);
}

export function stopSSE() {
  if (_es) { _es.close(); _es = null; }
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  _stopPoll();
}

export function isLive() { return _es !== null; }

function _connect(tokenFn) {
  const token = tokenFn ? tokenFn() : '';
  const url = token ? `/events?token=${encodeURIComponent(token)}` : '/events';
  _es = new EventSource(url);

  _es.addEventListener('dashboard', (e) => {
    _stopPoll(); // SSE is live — no polling needed
    if (_paused) return;
    try {
      const data = JSON.parse(e.data);
      set({ payload: data });
      if (_onEvent) _onEvent(data);
    } catch (_) {}
  });

  _es.addEventListener('error', () => {
    stopSSE();
    if (_pollCallback && document.visibilityState !== 'hidden') _startPoll(_pollCallback);
    // Reconnect after 5 s
    _reconnectTimer = setTimeout(() => _connect(tokenFn), 5000);
  });
}

function _startPoll(fn) {
  _stopPoll();
  if (_es) return; // SSE is live — no polling needed
  _pollTimer = setInterval(fn, _pollInterval);
}

function _stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function _pause() { _paused = true; }
function _resume() {
  _paused = false;
}
