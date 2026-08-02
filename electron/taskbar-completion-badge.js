const MAX_BADGE_COUNT = 99;
const MAX_SEEN_TASKS = 256;

function createTaskbarCompletionBadge(options = {}) {
  const {
    nativeImage,
    platform = process.platform,
    getWindow = () => null,
    isApplicationOpen = () => false
  } = options;
  if (!nativeImage || typeof nativeImage.createFromDataURL !== 'function') {
    throw new TypeError('Electron nativeImage is required for taskbar completion badges.');
  }

  let count = 0;
  const seenTaskIds = new Set();
  const seenOrder = [];
  const knownWindows = new Set();

  function markCompleted(task = {}) {
    const taskId = String(task.taskId || task.work_id || task.id || '').trim();
    if (taskId && seenTaskIds.has(taskId)) return snapshot();
    if (taskId) remember(taskId);
    if (isApplicationOpen()) {
      clear();
      return snapshot();
    }
    count = Math.min(MAX_BADGE_COUNT, count + 1);
    apply();
    return snapshot();
  }

  function clear() {
    count = 0;
    const primary = getWindow();
    if (primary) knownWindows.add(primary);
    for (const win of [...knownWindows]) {
      if (!win || win.isDestroyed?.()) {
        knownWindows.delete(win);
        continue;
      }
      apply(win);
    }
    return snapshot();
  }

  function apply(windowOverride) {
    if (platform !== 'win32') return false;
    const win = windowOverride || getWindow();
    if (!win || win.isDestroyed?.() || typeof win.setOverlayIcon !== 'function') return false;
    knownWindows.add(win);
    if (count === 0) {
      win.setOverlayIcon(null, '');
      return true;
    }
    const image = createBadgeImage(nativeImage, count);
    win.setOverlayIcon(image, `${count} completed ${count === 1 ? 'task' : 'tasks'} waiting to be viewed`);
    return true;
  }

  function remember(taskId) {
    seenTaskIds.add(taskId);
    seenOrder.push(taskId);
    while (seenOrder.length > MAX_SEEN_TASKS) {
      seenTaskIds.delete(seenOrder.shift());
    }
  }

  function snapshot() {
    return { count, visible: count > 0, supported: platform === 'win32' };
  }

  return { apply, clear, getStatus: snapshot, markCompleted };
}

function createBadgeImage(nativeImage, count) {
  const label = String(Math.min(MAX_BADGE_COUNT, Math.max(1, Number(count) || 1)));
  const fontSize = label.length > 1 ? 8 : 11;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.5" fill="#137a4c" stroke="#ffffff"/><text x="8" y="11.5" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${label}</text></svg>`;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  return typeof image.resize === 'function' ? image.resize({ width: 16, height: 16, quality: 'best' }) : image;
}

export { MAX_BADGE_COUNT, createBadgeImage, createTaskbarCompletionBadge };
