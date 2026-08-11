// Reactive store — replaces window.lastData / window.__relaiSettingsPayload globals
let _state = {};
const _listeners = new Set();

export function get() { return _state; }



export function init(initial) {
  _state = initial || {};
}
