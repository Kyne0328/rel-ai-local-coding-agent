function combineAbortSignals(...values) {
  const signals = values.flat().filter(signal => signal && typeof signal.addEventListener === 'function');
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

export { combineAbortSignals };
