import { closeModal, openModal } from './components/modal.js';
import { toast } from './components/toast.js';

const RELEASES_URL = 'https://github.com/Kyne0328/rel-ai-mcp/releases';

function supportPolicyModalView(policy) {
  const state = String(policy?.state || '');
  if (!['deprecated', 'required', 'emergency_blocked'].includes(state)) return null;
  const currentVersion = cleanVersion(policy?.currentVersion);
  const minimumSupportedVersion = cleanVersion(policy?.minimumSupportedVersion);
  const minimumRecommendedVersion = cleanVersion(policy?.minimumRecommendedVersion || minimumSupportedVersion);
  const enforceAfter = cleanIso(policy?.enforceAfter);
  const minimumVersion = state === 'recommended' ? minimumRecommendedVersion : minimumSupportedVersion;
  const key = [state, currentVersion, minimumSupportedVersion, minimumRecommendedVersion, enforceAfter].join(':');

  if (state === 'emergency_blocked') {
    return {
      key,
      state,
      blocking: true,
      allowLater: false,
      minimumVersion,
      title: 'Critical update required',
      description: policy?.message || `Rel.AI MCP v${currentVersion || 'this version'} needs an urgent update before Rel.AI can work with ChatGPT again.`
    };
  }
  if (state === 'required') {
    return {
      key,
      state,
      blocking: true,
      allowLater: false,
      minimumVersion,
      title: 'Update required',
      description: policy?.message || `This Rel.AI MCP version is no longer supported. Update to v${minimumVersion || 'the current release'} or newer to continue.`
    };
  }
  if (state === 'deprecated') {
    const deadline = enforceAfter ? formatPolicyDate(enforceAfter) : '';
    return {
      key,
      state,
      blocking: false,
      allowLater: true,
      minimumVersion,
      title: 'Update required soon',
      description: deadline
        ? `Support for this version ends on ${deadline}. Update to v${minimumVersion || 'the current release'} or newer before then.`
        : `Support for this version is ending. Update to v${minimumVersion || 'the current release'} or newer soon to stay supported.`
    };
  }
  return {
    key,
    state,
    blocking: false,
    allowLater: true,
    minimumVersion,
    title: 'Update recommended',
    description: `Rel.AI MCP v${minimumVersion || 'a newer version'} or newer is recommended.`
  };
}

function initUpdateAvailableModal(options = {}) {
  const bridge = options.bridge || window.relaiDesktop;
  if (!bridge?.getUpdateStatus) return () => {};

  const shownPolicyKeys = new Set();
  let latestStatus = null;
  let removeUpdateListener = null;
  let activePolicyKey = '';
  let policyContent = null;

  function consider(status) {
    latestStatus = status || latestStatus;
    const policyView = supportPolicyModalView(latestStatus?.supportPolicy);
    if (policyView) {
      if (updateActionInProgress(latestStatus)) {
        if (activePolicyKey) {
          activePolicyKey = '';
          policyContent = null;
          closeModal();
        }
        return;
      }
      const acknowledged = shownPolicyKeys.has(policyView.key);
      if (policyView.blocking || !acknowledged || activePolicyKey === policyView.key) {
        if (!policyView.blocking) shownPolicyKeys.add(policyView.key);
        showOrUpdateSupportPolicyModal(policyView, latestStatus);
      }
      return;
    }
    if (activePolicyKey) {
      activePolicyKey = '';
      policyContent = null;
      closeModal();
    }
  }

  if (typeof bridge.onUpdateStatus === 'function') {
    removeUpdateListener = bridge.onUpdateStatus(status => consider(status));
  }
  void bridge.getUpdateStatus().then(status => {
    latestStatus = status;
    consider(status);
  }).catch(() => {});

  function showOrUpdateSupportPolicyModal(view, status) {
    if (activePolicyKey !== view.key || !policyContent?.isConnected) {
      activePolicyKey = view.key;
      policyContent = document.createElement('div');
      renderSupportPolicyContent(policyContent, view, status);
      openModal({
        title: view.title,
        content: policyContent,
        escDisabled: view.blocking,
        onClose: () => {
          activePolicyKey = '';
          policyContent = null;
        }
      });
      return;
    }
    const title = document.getElementById('__relai-modal-title');
    if (title) title.textContent = view.title;
    renderSupportPolicyContent(policyContent, view, status);
  }

  function renderSupportPolicyContent(content, view, status) {
    content.replaceChildren();
    const description = document.createElement('p');
    description.textContent = view.description;
    const detail = document.createElement('p');
    detail.className = 'muted';
    detail.textContent = view.blocking
      ? 'You can still use the dashboard and update controls, but Rel.AI cannot work with ChatGPT until a supported version is installed.'
      : 'You can update now or continue for this launch. This notice will appear again on a future launch while this version is nearing the end of support.';
    const actions = document.createElement('div');
    actions.className = 'connection-actions';
    const action = supportUpdateAction(status);
    if (action.kind === 'link') {
      const link = document.createElement('a');
      link.className = 'buttonlike primary';
      link.href = RELEASES_URL;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = action.label;
      actions.appendChild(link);
    } else {
      const primary = actionButton(action.label, 'primary');
      primary.disabled = action.disabled;
      if (action.busy) primary.setAttribute('aria-busy', 'true');
      primary.addEventListener('click', () => runSupportUpdateAction(primary, action.method));
      actions.appendChild(primary);
    }
    if (view.allowLater) {
      const later = actionButton('Later', 'secondary');
      later.addEventListener('click', closeModal);
      actions.appendChild(later);
    }
    content.append(description, detail, actions);
  }

  async function runSupportUpdateAction(button, method) {
    if (!method || typeof bridge?.[method] !== 'function') return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    closeModal();
    try {
      const result = await bridge[method]();
      if (result?.ok === false) throw new Error(result.error || 'The update action failed.');
      if (result?.status) latestStatus = { ...latestStatus, ...result.status };
      consider(latestStatus);
    } catch (error) {
      toast(messageOf(error), { variant: 'error' });
    }
  }

  return () => removeUpdateListener?.();
}

function updateActionInProgress(status = {}) {
  return ['checking', 'downloading', 'installing'].includes(String(status?.state || ''));
}

function supportUpdateAction(status = {}) {
  const state = String(status.state || 'idle');
  if (state === 'unsupported') return { kind: 'link', label: 'Open GitHub Releases' };
  if (state === 'available') return { kind: 'button', method: 'downloadUpdate', label: `Download v${cleanVersion(status.availableVersion) || 'update'}`, disabled: false, busy: false };
  if (state === 'downloaded') return { kind: 'button', method: 'installUpdate', label: 'Restart and install', disabled: false, busy: false };
  if (state === 'checking') return { kind: 'button', method: '', label: 'Checking for update…', disabled: true, busy: true };
  if (state === 'downloading') return { kind: 'button', method: '', label: 'Downloading update…', disabled: true, busy: true };
  if (state === 'installing') return { kind: 'button', method: '', label: 'Installing update…', disabled: true, busy: true };
  return { kind: 'button', method: 'checkForUpdates', label: state === 'error' ? 'Try update check again' : 'Check for update', disabled: false, busy: false };
}

function actionButton(label, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

function cleanVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').slice(0, 80);
}

function cleanIso(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function formatPolicyDate(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Application update action failed.');
}

export { initUpdateAvailableModal, supportPolicyModalView };
