import { openModal } from './components/modal.js';

const CONNECTOR_REFRESH_VERSIONS = new Set(['0.26.0']);
const DISMISS_DELAY_MS = 5000;
const STORAGE_PREFIX = 'relai_connector_refresh';
const REFRESH_STEPS = Object.freeze([
  'Open Settings.',
  'Open Plugins.',
  'Select the Rel.AI MCP connector.',
  'Scroll to the bottom and open Information.',
  'Click Refresh.'
]);

function prepareConnectorRefreshNotice(lifecycle = {}, storage) {
  const currentVersion = cleanVersion(lifecycle.currentVersion);
  if (!CONNECTOR_REFRESH_VERSIONS.has(currentVersion)) return null;

  const acknowledgedKey = storageKey('acknowledged', currentVersion);
  const pendingKey = storageKey('pending', currentVersion);
  if (readStorage(storage, acknowledgedKey) === '1') {
    removeStorage(storage, pendingKey);
    return null;
  }

  const previousVersion = cleanVersion(lifecycle.previousVersion);
  const updatedIntoRelease = lifecycle.updated === true && previousVersion && previousVersion !== currentVersion;
  if (updatedIntoRelease) writeStorage(storage, pendingKey, '1');
  const pending = updatedIntoRelease || readStorage(storage, pendingKey) === '1';
  if (!pending) return null;

  return {
    currentVersion,
    previousVersion,
    acknowledgedKey,
    pendingKey,
    title: 'Refresh Rel.AI MCP in ChatGPT',
    description: `Rel.AI MCP ${currentVersion} changed the tools ChatGPT uses. Refresh the connector so ChatGPT loads the new tool schema.`,
    steps: REFRESH_STEPS,
    dismissDelayMs: DISMISS_DELAY_MS
  };
}

function acknowledgeConnectorRefreshNotice(view, storage) {
  if (!view?.acknowledgedKey) return;
  writeStorage(storage, view.acknowledgedKey, '1');
  removeStorage(storage, view.pendingKey);
}

function initConnectorRefreshModal(options = {}) {
  const bridge = options.bridge || window.relaiDesktop;
  const storage = options.storage || window.localStorage;
  const now = options.now || Date.now;
  const setIntervalFn = options.setInterval || window.setInterval.bind(window);
  const clearIntervalFn = options.clearInterval || window.clearInterval.bind(window);
  if (!bridge?.getLifecycleStatus) return () => {};

  let cancelled = false;
  let countdownTimer = null;

  void bridge.getLifecycleStatus().then(lifecycle => {
    if (cancelled) return;
    const view = prepareConnectorRefreshNotice(lifecycle, storage);
    if (!view) return;

    const content = document.createElement('div');
    content.className = 'confirm-dialog';

    const description = document.createElement('p');
    description.textContent = view.description;

    const steps = document.createElement('div');
    steps.className = 'confirm-dialog-copy';
    const heading = document.createElement('strong');
    heading.textContent = 'In ChatGPT:';
    steps.appendChild(heading);
    view.steps.forEach((step, index) => {
      const line = document.createElement('span');
      line.textContent = `${index + 1}. ${step}`;
      steps.appendChild(line);
    });

    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'You only need to acknowledge this notice once for this Rel.AI update.';

    const actions = document.createElement('div');
    actions.className = 'connection-actions';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'primary';
    dismiss.disabled = true;
    actions.appendChild(dismiss);
    content.append(description, steps, note, actions);

    const unlockAt = now() + view.dismissDelayMs;
    const updateCountdown = () => {
      const remainingMs = Math.max(0, unlockAt - now());
      if (remainingMs > 0) {
        dismiss.disabled = true;
        dismiss.textContent = `I understand (${Math.ceil(remainingMs / 1000)}s)`;
        return;
      }
      dismiss.disabled = false;
      dismiss.textContent = 'I understand';
      if (countdownTimer) clearIntervalFn(countdownTimer);
      countdownTimer = null;
    };

    const modal = openModal({
      title: view.title,
      content,
      escDisabled: true,
      onClose: () => {
        if (countdownTimer) clearIntervalFn(countdownTimer);
        countdownTimer = null;
      }
    });
    dismiss.addEventListener('click', () => {
      if (dismiss.disabled) return;
      acknowledgeConnectorRefreshNotice(view, storage);
      modal.close();
    });

    updateCountdown();
    if (dismiss.disabled) countdownTimer = setIntervalFn(updateCountdown, 250);
  }).catch(() => {});

  return () => {
    cancelled = true;
    if (countdownTimer) clearIntervalFn(countdownTimer);
    countdownTimer = null;
  };
}

function storageKey(kind, version) {
  return `${STORAGE_PREFIX}:${kind}:${version}`;
}

function readStorage(storage, key) {
  try { return storage?.getItem?.(key) || ''; } catch { return ''; }
}

function writeStorage(storage, key, value) {
  try { storage?.setItem?.(key, value); } catch {}
}

function removeStorage(storage, key) {
  try { storage?.removeItem?.(key); } catch {}
}

function cleanVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').slice(0, 80);
}

export {
  CONNECTOR_REFRESH_VERSIONS,
  DISMISS_DELAY_MS,
  REFRESH_STEPS,
  acknowledgeConnectorRefreshNotice,
  initConnectorRefreshModal,
  prepareConnectorRefreshNotice
};
