// Reactive store — replaces window.lastData / window.__relaiSettingsPayload globals
let _state = {};
const _listeners = new Set();

export function get() { return _state; }

export function set(patch) {
  _state = { ..._state, ...patch };
  for (const fn of _listeners) fn(_state);
}

export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function init(initial) {
  _state = initial || {};
}
