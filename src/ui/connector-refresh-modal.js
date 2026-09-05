import { openModal } from './components/modal.js';
import { CHATGPT_REFRESH_BUSINESS_NOTE, CHATGPT_REFRESH_STEPS } from './features/settings/connection-guidance.js';

const STORAGE_PREFIX = 'relai_connector_refresh';

function prepareConnectorRefreshNotice(lifecycle = {}, storage) {
  const currentVersion = cleanVersion(lifecycle.currentVersion);
  const connectorRevision = cleanRevision(lifecycle.connectorRevision) || currentVersion;
  if (!connectorRevision) return null;

  const acknowledgedKey = storageKey('acknowledged', connectorRevision);
  const pendingKey = storageKey('pending', connectorRevision);
  if (readStorage(storage, acknowledgedKey) === '1') {
    removeStorage(storage, pendingKey);
    return null;
  }

  const previousVersion = cleanVersion(lifecycle.previousVersion);
  const connectorChanged = lifecycle.connectorRefreshRequired === true;
  if (connectorChanged) writeStorage(storage, pendingKey, '1');
  const pending = connectorChanged || readStorage(storage, pendingKey) === '1';
  if (!pending) return null;

  return {
    currentVersion,
    previousVersion,
    connectorRevision,
    acknowledgedKey,
    pendingKey,
    title: 'Refresh Rel.AI MCP in ChatGPT',
    description: `Rel.AI MCP ${currentVersion} changed its ChatGPT action definitions. ChatGPT keeps an approved snapshot, so review the updated actions before using the new tool surface.`,
    steps: CHATGPT_REFRESH_STEPS,
    businessNote: CHATGPT_REFRESH_BUSINESS_NOTE
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
  if (!bridge?.getLifecycleStatus) return () => {};

  let cancelled = false;

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
    const list = document.createElement('ol');
    list.className = 'modal-step-list';
    view.steps.forEach(step => {
      const item = document.createElement('li');
      item.textContent = step;
      list.appendChild(item);
    });
    steps.append(heading, list);

    const businessNote = document.createElement('p');
    businessNote.className = 'muted';
    businessNote.textContent = view.businessNote;

    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'You can dismiss this notice now. It will not appear again for this Rel.AI action revision.';

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'primary';
    dismiss.textContent = 'Done';
    actions.appendChild(dismiss);
    content.append(description, steps, businessNote, note, actions);

    const modal = openModal({
      title: view.title,
      content,
      size: 'compact',
      onClose: () => acknowledgeConnectorRefreshNotice(view, storage)
    });
    dismiss.addEventListener('click', () => modal.close());
  }).catch(() => {});

  return () => {
    cancelled = true;
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

function cleanRevision(value) {
  return String(value || '').trim().slice(0, 240);
}

export {
  acknowledgeConnectorRefreshNotice,
  initConnectorRefreshModal,
  prepareConnectorRefreshNotice
};
