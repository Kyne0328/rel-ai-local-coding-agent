import { formatDuration, timeAgo } from './utils.js';

export function parseClockTime(value) {
  if (value == null || value === '') return Number.NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== '') return numeric;
  return Date.parse(String(value));
}

export function elapsedAt(start, end, now = Date.now()) {
  const started = parseClockTime(start);
  if (!Number.isFinite(started)) return '';
  const completed = parseClockTime(end);
  const boundary = Number.isFinite(completed) ? completed : now;
  return formatDuration(Math.max(0, boundary - started));
}

export function createDashboardClock(options = {}) {
  const documentRef = options.documentRef || document;
  const windowRef = options.windowRef || window;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const intervalMs = Math.max(250, Number(options.intervalMs || 1000));
  const setIntervalFn = options.setIntervalFn || windowRef.setInterval.bind(windowRef);
  const clearIntervalFn = options.clearIntervalFn || windowRef.clearInterval.bind(windowRef);
  const onTick = typeof options.onTick === 'function' ? options.onTick : null;
  let timer = null;
  let stopped = true;

  function updateNode(node, currentTime) {
    if (node.hasAttribute('data-clock-elapsed-start')) {
      const text = elapsedAt(
        node.getAttribute('data-clock-elapsed-start'),
        node.getAttribute('data-clock-elapsed-end'),
        currentTime
      );
      if (text && node.textContent !== text) node.textContent = text;
    }
    if (node.hasAttribute('data-clock-relative')) {
      const text = timeAgo(node.getAttribute('data-clock-relative'), currentTime);
      if (text && node.textContent !== text) node.textContent = text;
    }
  }

  function tick() {
    const currentTime = now();
    for (const node of documentRef.querySelectorAll('[data-clock-elapsed-start], [data-clock-relative]')) {
      updateNode(node, currentTime);
    }
    onTick?.(currentTime);
  }

  function startTimer() {
    if (timer != null || stopped || documentRef.visibilityState === 'hidden') return;
    timer = setIntervalFn(tick, intervalMs);
    timer?.unref?.();
  }

  function stopTimer() {
    if (timer == null) return;
    clearIntervalFn(timer);
    timer = null;
  }

  function handleVisibility() {
    if (documentRef.visibilityState === 'hidden') {
      stopTimer();
      return;
    }
    tick();
    startTimer();
  }

  function start() {
    if (!stopped) return api;
    stopped = false;
    documentRef.addEventListener?.('visibilitychange', handleVisibility);
    tick();
    startTimer();
    return api;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    stopTimer();
    documentRef.removeEventListener?.('visibilitychange', handleVisibility);
  }

  const api = { start, stop, tick, isRunning: () => !stopped && timer != null };
  return api;
}
