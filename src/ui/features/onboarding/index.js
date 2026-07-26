// Onboarding wizard — 5-step modal carousel
import { openModal, closeModal } from '../../components/modal.js';
import { fetchJson, postJson } from '../../api.js';
import { toast } from '../../components/toast.js';
import { copyText } from '../../clipboard.js';
import { runButtonAction } from '../../action-state.js';

let _step = 0;
let _data = {};
let _modal = null;
let _wrapper = null;

const STEPS = ['Welcome', 'Add workspace', 'Workspace access', 'Connect ChatGPT', 'Done'];

export function openOnboarding() {
  removeDesktopHandoff();
  _step = 0;
  _data = {
    workspaceAlias: '',
    workspacePath: '',
    workspaceCreated: false,
    createdWorkspaceAlias: '',
    createdWorkspacePath: '',
    workspaceCheck: null,
    aliasEdited: false
  };

  _wrapper = document.createElement('div');
  _wrapper.className = 'onboarding-shell';

  _modal = openModal({
    title: 'Set up Rel.AI MCP',
    content: _wrapper,
    onClose: _onModalClose
  });

  _modal.backdrop.addEventListener('click', (e) => {
    if (e.target === _modal.backdrop && _step < STEPS.length - 1) {
      closeModal();
      _onModalClose();
    }
  });

  _showStep();
}

function _onModalClose() {
  _modal = null;
  _wrapper = null;
  if (_step < STEPS.length - 1) _doSkip();
}

function _showStep() {
  if (!_wrapper) return;
  _wrapper.innerHTML = '';

  const stepLabel = document.createElement('div');
  stepLabel.className = 'onboarding-step-label';
  stepLabel.textContent = `Step ${_step + 1} of ${STEPS.length}`;

  const content = document.createElement('div');
  content.className = 'onboarding-content';

  const footer = document.createElement('div');
  footer.className = 'onboarding-footer';

  const navLeft = document.createElement('div');
  navLeft.className = 'onboarding-footer-actions';

  const backBtn = document.createElement('button');
  backBtn.className = 'secondary onboarding-compact-action';
  backBtn.textContent = 'Back';
  backBtn.onclick = _back;
  backBtn.hidden = !(_step > 0 && _step < STEPS.length - 1);

  const skipBtn = document.createElement('button');
  skipBtn.className = 'secondary onboarding-compact-action onboarding-skip-action';
  skipBtn.textContent = 'Skip for now';
  skipBtn.onclick = () => { if (_modal) _modal.close(); };
  skipBtn.hidden = _step === STEPS.length - 1;

  navLeft.appendChild(backBtn);
  navLeft.appendChild(skipBtn);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = _step === STEPS.length - 1 ? 'Done' : 'Continue';
  nextBtn.onclick = () => _next(nextBtn);

  footer.appendChild(navLeft);
  footer.appendChild(nextBtn);

  _wrapper.appendChild(stepLabel);
  _wrapper.appendChild(content);
  _wrapper.appendChild(footer);

  _renderStep(_step, content, nextBtn, skipBtn, backBtn);

  const focusable = _modal.dialog.querySelectorAll('button:not([disabled]),input:not([disabled])');
  if (focusable[0]) focusable[0].focus();
}

function _renderStep(step, content, nextBtn, skipBtn, backBtn) {
  if (step === 0) {
    content.innerHTML = '<p class="onboarding-copy">Rel.AI MCP gives ChatGPT explicit tools for configured local workspaces: inspect the repo, read exact files, make focused edits, run checks, and review the diff.</p><p class="onboarding-copy">This setup gets one workspace and the ChatGPT app connection ready so your first request can be a safe read-only check.</p>';
    _withConnection(content);
    nextBtn.textContent = 'Start setup';
  } else if (step === 1) {
    nextBtn.textContent = _data.workspaceCreated ? 'Continue' : 'Add workspace';
    content.innerHTML = '<h3 class="onboarding-heading">Add your first workspace</h3><p class="onboarding-description">A workspace is a local folder that Rel.AI can inspect, edit, validate, and review for ChatGPT.</p>';

    const aliasInput = document.createElement('input');
    aliasInput.type = 'text';
    aliasInput.placeholder = 'Alias (short name, for example acme-web)';
    aliasInput.className = 'onboarding-input';
    aliasInput.value = _data.workspaceAlias || '';

    const pathInput = document.createElement('input');
    pathInput.type = 'text';
    pathInput.placeholder = 'Absolute folder path';
    pathInput.className = 'onboarding-input';
    pathInput.value = _data.workspacePath || '';

    const pathRow = document.createElement('div');
    pathRow.className = 'ws-form-row';

    const browseBtn = document.createElement('button');
    browseBtn.type = 'button';
    browseBtn.className = 'secondary';
    browseBtn.textContent = 'Browse…';
    pathRow.appendChild(pathInput);
    pathRow.appendChild(browseBtn);

    const hint = document.createElement('div');
    hint.className = 'onboarding-hint';
    hint.textContent = 'Tip: the alias can be short. The folder path must be absolute.';

    const validation = document.createElement('div');
    validation.className = 'onboarding-validation';
    validation.setAttribute('aria-live', 'polite');
    validation.setAttribute('aria-atomic', 'true');
    renderValidation(validation, _data.workspaceCheck);

    const createdNote = document.createElement('div');
    createdNote.className = 'empty onboarding-created-note';
    createdNote.hidden = !_data.workspaceCreated;
    if (_data.workspaceCreated) {
      createdNote.textContent = `Workspace '${_data.createdWorkspaceAlias}' is already saved for this setup run.`;
    }

    let validTimer;
    pathInput.addEventListener('input', () => {
      _data.workspacePath = pathInput.value.trim();
      const suggested = deriveAliasFromPath(_data.workspacePath);
      if (!_data.aliasEdited) {
        aliasInput.value = suggested;
        _data.workspaceAlias = suggested;
      }
      _data.workspaceCheck = null;
      renderValidation(validation, null);
      clearTimeout(validTimer);
      validTimer = setTimeout(async () => {
        const p = pathInput.value.trim();
        if (!p) return;
        validation.className = 'onboarding-validation';
        validation.textContent = 'Checking path…';
        _data.workspaceCheck = await validateWorkspacePath(p);
        renderValidation(validation, _data.workspaceCheck);
      }, 350);
    });

    aliasInput.addEventListener('input', () => {
      _data.workspaceAlias = aliasInput.value.trim();
      _data.aliasEdited = true;
    });

    browseBtn.addEventListener('click', async () => {
      clearTimeout(validTimer);
      const res = await runButtonAction(browseBtn, {
        idleText: 'Browse…',
        loadingText: 'Opening folder picker…',
        successText: 'Folder selected',
        errorText: 'Browse failed'
      }, () => postJson('/api/pick-folder', {}, { timeout: 0 }));
      if (res?.unsupported) {
        browseBtn.hidden = true;
        toast('Browse needs the Rel.AI desktop launcher — type the path here instead.', { variant: 'info' });
        return;
      }
      if (res?.canceled) return;
      if (res?.ok && res.path) {
        pathInput.value = res.path;
        _data.workspacePath = res.path;
        if (!_data.aliasEdited) {
          const suggested = deriveAliasFromPath(res.path);
          aliasInput.value = suggested;
          _data.workspaceAlias = suggested;
        }
        _data.workspaceCheck = res;
        renderValidation(validation, res);
      } else if (res?.error) {
        toast('Could not open folder picker: ' + res.error, { variant: 'error' });
      }
    });

    const submitWorkspace = async () => {
      const alias = aliasInput.value.trim();
      const workspacePath = pathInput.value.trim();
      _data.workspaceAlias = alias;
      _data.workspacePath = workspacePath;

      if (!alias || !workspacePath) {
        toast('Enter both alias and folder path.', { variant: 'warn' });
        return;
      }
      if (!isValidAlias(alias)) {
        toast('Use letters, numbers, dots, dashes, or underscores for the alias.', { variant: 'warn' });
        return;
      }

      const check = await validateWorkspacePath(workspacePath);
      _data.workspaceCheck = check;
      renderValidation(validation, check);
      if (!check?.exists || !check?.isDirectory) {
        toast('Choose an existing folder path.', { variant: 'error' });
        return;
      }

      if (_data.workspaceCreated && _data.createdWorkspaceAlias === alias && _data.createdWorkspacePath === workspacePath) {
        _step++;
        _showStep();
        return;
      }

      setBusy(nextBtn, true, 'Adding…');
      const result = await postJson('/api/workspaces', {
        action: 'upsert',
        alias,
        path: workspacePath,
        protectedBranches: ['main', 'master'],
        defaultBaseBranch: 'main',
        allowedRemotes: ['origin']
      });
      setBusy(nextBtn, false, 'Continue');

      if (result?.ok !== true) {
        toast('Could not add workspace: ' + (result?.error || 'unknown error'), { variant: 'error' });
        return;
      }

      _data.workspaceCreated = true;
      _data.createdWorkspaceAlias = alias;
      _data.createdWorkspacePath = workspacePath;
      toast('Workspace added: ' + alias, { variant: 'success' });
      _step++;
      _showStep();
    };

    pathInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitWorkspace();
    });
    aliasInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitWorkspace();
    });

    content.appendChild(aliasInput);
    content.appendChild(pathRow);
    content.appendChild(hint);
    content.appendChild(validation);
    content.appendChild(createdNote);
    nextBtn.onclick = submitWorkspace;
  } else if (step === 2) {
    nextBtn.textContent = 'Continue';
    content.innerHTML = '<h3 class="onboarding-heading">How to ask for work</h3><p class="onboarding-description">Tell ChatGPT which workspace alias to use, then ask for the smallest useful first step. For new repos, start with status and snapshot before requesting edits.</p><div class="empty onboarding-example"><strong class="onboarding-example-title">Good first prompt</strong><br><code>Use Rel.AI MCP on workspace "myapp". Call relai_status with this workspace and relai_repo_snapshot. Do not modify files yet.</code></div>';
    nextBtn.onclick = async () => {
      _step++;
      _showStep();
    };
  } else if (step === 3) {
    nextBtn.textContent = 'Continue';
    content.innerHTML = '<h3 class="onboarding-heading">Connect ChatGPT</h3><p class="onboarding-description">Create a ChatGPT app, paste the MCP endpoint below, choose OAuth, and approve with your approval token. After that, select the Rel.AI MCP app in any chat.</p>';
    _withConnection(content, true);
  } else if (step === 4) {
    nextBtn.textContent = 'Done';
    skipBtn.hidden = true;
    backBtn.hidden = true;
    const workspaceLine = _data.workspaceCreated
      ? `Workspace <strong>${escapeHtml(_data.createdWorkspaceAlias)}</strong> is saved and ready.`
      : 'You can add a workspace later from the Workspaces page.';
    content.innerHTML = `<div class="onboarding-complete"><div class="onboarding-complete-mark" aria-hidden="true">✓</div><div class="onboarding-complete-title">Setup complete</div><div class="onboarding-complete-copy">${workspaceLine}<br>Select the Rel.AI MCP app in ChatGPT and ask for a read-only status check first.</div></div>`;
    nextBtn.onclick = async () => {
      await postJson('/api/onboarding/complete', { completed: true });
      closeModal();
      _modal = null;
      _wrapper = null;
      toast('Setup complete — you can start using Rel.AI MCP now.', { variant: 'success' });
    };
  }
}

async function _withConnection(content, showCopy = false) {
  const conn = await fetchJson('/api/connection');
  if (!conn) return;
  if (showCopy && conn.chatgptMcpUrl) {
    const urlBox = document.createElement('div');
    urlBox.className = 'onboarding-endpoint-row';
    const code = document.createElement('code');
    code.className = 'onboarding-endpoint';
    code.textContent = conn.chatgptMcpUrl;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'secondary onboarding-copy-action';
    copyBtn.textContent = 'Copy';
    copyBtn.onclick = async () => {
      try {
        await copyText(conn.chatgptMcpUrl);
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
      } catch {
        toast('Clipboard access failed.', { variant: 'error' });
      }
    };
    urlBox.appendChild(code);
    urlBox.appendChild(copyBtn);
    content.appendChild(urlBox);
    const appSteps = document.createElement('div');
    appSteps.className = 'setup-steps';
    appSteps.innerHTML = [
      'ChatGPT Settings > Apps > Create (or Workspace Settings > Apps > Create for admins).',
      'Paste this MCP endpoint and choose OAuth.',
      'Approve with your Rel.AI approval token, then select the app in chat.'
    ].map((step, index) => `<div class="step"><span class="step-num">${index + 1}</span><div>${escapeHtml(step)}</div></div>`).join('');
    content.appendChild(appSteps);
  }

  const status = document.createElement('div');
  status.className = `onboarding-connection-status ${conn.permanentUrlConfigured ? 'good' : 'warn'}`;
  status.textContent = conn.permanentUrlConfigured
    ? 'Permanent URL configured. This is the best setup for a stable ChatGPT connector.'
    : 'No permanent public URL is configured yet. Local testing still works, but the ChatGPT connection may change unless you add a stable HTTPS URL.';
  content.appendChild(status);

  if (Array.isArray(conn.nextSteps) && conn.nextSteps.length) {
    const steps = document.createElement('div');
    steps.className = 'setup-steps';
    steps.innerHTML = conn.nextSteps.slice(0, 2).map((step, index) => `<div class="step"><span class="step-num">${index + 1}</span><div>${escapeHtml(step)}</div></div>`).join('');
    content.appendChild(steps);
  }
}

async function _next(_nextBtn) {
  _step++;
  if (_step >= STEPS.length) _step = STEPS.length - 1;
  _showStep();
}

function _back() {
  _step = Math.max(0, _step - 1);
  _showStep();
}

async function _doSkip() {
  await postJson('/api/onboarding/complete', { completed: false, skipped: true });
  _showSkipBanner();
}

export function showDesktopHandoff() {
  if (document.getElementById('__desktop-setup-handoff')) return;
  const banner = document.createElement('section');
  banner.id = '__desktop-setup-handoff';
  banner.className = 'connection-notice info desktop-setup-handoff';
  banner.innerHTML = '<div><strong>Desktop setup is complete.</strong><br><span class="muted">Finish the two application steps below. Rel.AI will not reopen the browser onboarding wizard.</span></div>';

  const actions = document.createElement('div');
  actions.className = 'connection-actions';
  const connection = document.createElement('a');
  connection.className = 'buttonlike primary';
  connection.href = '#settings/connection';
  connection.textContent = 'Connect ChatGPT';
  const workspaces = document.createElement('a');
  workspaces.className = 'buttonlike secondary';
  workspaces.href = '#workspaces';
  workspaces.textContent = 'Add workspace';
  const dismiss = document.createElement('button');
  dismiss.className = 'secondary';
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss guide';
  dismiss.addEventListener('click', async () => {
    await postJson('/api/onboarding/complete', {
      skipped: true,
      source: 'desktop-setup',
      handoffPending: false
    });
    removeDesktopHandoff();
    toast('Desktop setup guide dismissed.', { variant: 'info' });
  });
  actions.append(connection, workspaces, dismiss);
  banner.appendChild(actions);
  document.getElementById('main')?.prepend(banner);
}

function removeDesktopHandoff() {
  document.getElementById('__desktop-setup-handoff')?.remove();
}

function _showSkipBanner() {
  const existing = document.getElementById('__onb-banner');
  if (existing) return;
  const banner = document.createElement('div');
  banner.id = '__onb-banner';
  banner.className = 'onboarding-resume-banner';
  banner.innerHTML = '<span class="onboarding-resume-label">Setup not complete</span>';
  const resumeBtn = document.createElement('button');
  resumeBtn.className = 'secondary onboarding-compact-action';
  resumeBtn.textContent = 'Resume setup';
  resumeBtn.onclick = openOnboarding;
  banner.appendChild(resumeBtn);
  const main = document.getElementById('main');
  if (main) main.prepend(banner);
}

async function validateWorkspacePath(workspacePath) {
  if (!workspacePath) return null;
  return fetchJson('/api/workspace/preflight?path=' + encodeURIComponent(workspacePath));
}

function renderValidation(el, result) {
  if (!el) return;
  el.className = 'onboarding-validation';
  if (!result) {
    el.textContent = '';
    return;
  }
  if (result.exists && result.isDirectory) {
    el.classList.add('success');
    el.textContent = result.isGit ? 'Path looks good. Git repository found.' : 'Path exists and can be added as a workspace.';
    return;
  }
  el.classList.add('error');
  const finding = Array.isArray(result.findings) && result.findings.length ? result.findings[0].message : 'Folder not found.';
  el.textContent = finding;
}

function trimTrailingPathSeparators(value) {
  let clean = String(value || '').trim();
  while (clean.endsWith('/') || clean.endsWith('\\')) clean = clean.slice(0, -1);
  return clean;
}

function pathLeaf(value) {
  return trimTrailingPathSeparators(value).split(/[\\/]/).findLast(Boolean) || '';
}

function aliasChar(ch) {
  const code = ch.codePointAt(0);
  const isLower = code >= 97 && code <= 122;
  const isDigit = code >= 48 && code <= 57;
  return isLower || isDigit || ch === '.' || ch === '_' || ch === '-' ? ch : '-';
}

function trimDashes(value) {
  let text = value;
  while (text.startsWith('-')) text = text.slice(1);
  while (text.endsWith('-')) text = text.slice(0, -1);
  return text;
}

function collapseDashes(value) {
  let out = '';
  for (const ch of value) {
    if (ch === '-' && out.endsWith('-')) continue;
    out += ch;
  }
  return out;
}

function deriveAliasFromPath(workspacePath) {
  return trimDashes(collapseDashes([...pathLeaf(workspacePath).toLowerCase()].map(aliasChar).join(''))).slice(0, 32);
}

function isValidAlias(alias) {
  const value = String(alias || '');
  if (!value) return false;
  const first = value.codePointAt(0);
  const firstValid = (first >= 65 && first <= 90) || (first >= 97 && first <= 122) || (first >= 48 && first <= 57);
  return firstValid && [...value].every((ch) => aliasChar(ch.toLowerCase()) === ch.toLowerCase());
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = label;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
