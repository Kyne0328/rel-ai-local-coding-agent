'use strict';

function combineAbortSignals(...values) {
  const signals = values.flat().filter(signal => signal && typeof signal.addEventListener === 'function');
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);

  const controller = new AbortController();
  const abort = signal => {
    if (!controller.signal.aborted) controller.abort(signal?.reason);
    for (const item of signals) item.removeEventListener?.('abort', listeners.get(item));
  };
  const listeners = new Map();
  for (const signal of signals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    const listener = () => abort(signal);
    listeners.set(signal, listener);
    signal.addEventListener('abort', listener, { once: true });
  }
  return controller.signal;
}

export { combineAbortSignals };
