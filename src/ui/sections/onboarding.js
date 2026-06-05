// Onboarding wizard — 5-step modal carousel
import { fetchJson, postJson } from '/ui/api.js';
import { toast } from '/ui/components/toast.js';

let _step = 0;
let _data = {};
const STEPS = ['Welcome', 'Add workspace', 'Workspace access', 'Connect ChatGPT', 'Done'];

export function openOnboarding() {
  _step = 0;
  _data = {
    workspaceAlias: '',
    workspacePath: '',
    workspaceCreated: false,
    createdWorkspaceAlias: '',
    createdWorkspacePath: '',
    workspaceCheck: null
  };
  _showStep();
}

function _showStep() {
  const backdrop = document.getElementById('__relai-modal-backdrop');
  if (backdrop) backdrop.remove();

  const bd = document.createElement('div');
  bd.id = '__relai-modal-backdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:var(--z-modal,60);padding:24px;';

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', '__onb-title');
  dialog.style.cssText = 'background:var(--surface);border:1px solid var(--line-soft);border-radius:16px;padding:32px;max-width:560px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.5);display:grid;gap:20px;';

  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;';
  const title = document.createElement('h2');
  title.id = '__onb-title';
  title.style.cssText = 'margin:0;font-size:18px;';
  title.textContent = 'Set up Rel.AI MCP';
  const stepLabel = document.createElement('span');
  stepLabel.style.cssText = 'font-size:12px;color:var(--text-muted);';
  stepLabel.textContent = `Step ${_step + 1} of ${STEPS.length}`;
  hdr.appendChild(title);
  hdr.appendChild(stepLabel);

  const content = document.createElement('div');
  content.style.cssText = 'display:grid;gap:14px;';

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';

  const navLeft = document.createElement('div');
  navLeft.style.cssText = 'display:flex;gap:8px;align-items:center;';

  const backBtn = document.createElement('button');
  backBtn.className = 'secondary';
  backBtn.style.cssText = 'font-size:12px;min-height:28px;';
  backBtn.textContent = 'Back';
  backBtn.onclick = _back;
  backBtn.style.display = _step > 0 && _step < STEPS.length - 1 ? '' : 'none';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'secondary';
  skipBtn.style.cssText = 'font-size:12px;min-height:28px;color:var(--text-muted);';
  skipBtn.textContent = 'Skip for now';
  skipBtn.onclick = _skip;
  skipBtn.style.display = _step === STEPS.length - 1 ? 'none' : '';

  navLeft.appendChild(backBtn);
  navLeft.appendChild(skipBtn);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = _step === STEPS.length - 1 ? 'Done' : 'Continue';
  nextBtn.onclick = () => _next(nextBtn);

  footer.appendChild(navLeft);
  footer.appendChild(nextBtn);

  dialog.appendChild(hdr);
  dialog.appendChild(content);
  dialog.appendChild(footer);
  bd.appendChild(dialog);
  document.body.appendChild(bd);

  _renderStep(_step, content, nextBtn, skipBtn, backBtn);
  nextBtn.focus();
}

function _renderStep(step, content, nextBtn, skipBtn, backBtn) {
  if (step === 0) {
    content.innerHTML = '<p style="font-size:14px;line-height:1.55;">Rel.AI MCP gives ChatGPT explicit tools for configured local workspaces: inspect the repo, read exact files, make focused edits, run checks, and review the diff.</p><p style="font-size:14px;line-height:1.55;">This setup gets one workspace and the ChatGPT app connection ready so your first request can be a safe read-only check.</p>';
    _withConnection(content);
    nextBtn.textContent = 'Start setup';
  } else if (step === 1) {
    nextBtn.textContent = _data.workspaceCreated ? 'Continue' : 'Add workspace';
    content.innerHTML = '<h3 style="margin:0;font-size:15px;">Add your first workspace</h3><p style="font-size:13px;color:var(--text-muted);line-height:1.5;">A workspace is a local folder that Rel.AI can inspect, edit, validate, and review for ChatGPT.</p>';

    const aliasInput = document.createElement('input');
    aliasInput.type = 'text';
    aliasInput.placeholder = 'Alias (short name, for example acme-web)';
    aliasInput.style.cssText = 'width:100%;';
    aliasInput.value = _data.workspaceAlias || '';

    const pathInput = document.createElement('input');
    pathInput.type = 'text';
    pathInput.placeholder = 'Absolute folder path';
    pathInput.style.cssText = 'width:100%;';
    pathInput.value = _data.workspacePath || '';

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;color:var(--text-muted);line-height:1.45;';
    hint.textContent = 'Tip: the alias can be short. The folder path must be absolute.';

    const validation = document.createElement('div');
    validation.style.cssText = 'font-size:12px;color:var(--text-muted);min-height:18px;';
    renderValidation(validation, _data.workspaceCheck);

    const createdNote = document.createElement('div');
    createdNote.className = 'empty';
    createdNote.style.cssText = 'display:none;text-align:left;padding:12px;line-height:1.5;border-color:rgba(71,221,138,.22);background:rgba(71,221,138,.07);';
    if (_data.workspaceCreated) {
      createdNote.style.display = 'block';
      createdNote.textContent = `Workspace '${_data.createdWorkspaceAlias}' is already saved for this setup run.`;
    }

    let validTimer;
    pathInput.addEventListener('input', () => {
      _data.workspacePath = pathInput.value.trim();
      const suggested = deriveAliasFromPath(_data.workspacePath);
      if (!aliasInput.value.trim() || aliasInput.value.trim() === deriveAliasFromPath(_data.workspaceAlias)) {
        aliasInput.value = suggested;
        _data.workspaceAlias = suggested;
      }
      _data.workspaceCheck = null;
      renderValidation(validation, null);
      clearTimeout(validTimer);
      validTimer = setTimeout(async () => {
        const p = pathInput.value.trim();
        if (!p) return;
        validation.style.color = 'var(--text-muted)';
        validation.textContent = 'Checking path…';
        _data.workspaceCheck = await validateWorkspacePath(p);
        renderValidation(validation, _data.workspaceCheck);
      }, 350);
    });

    aliasInput.addEventListener('input', () => {
      _data.workspaceAlias = aliasInput.value.trim();
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
      if (!check || !check.exists || !check.isDirectory) {
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
        allowedRemotes: ['origin'],
        confirmDangerous: true
      });
      setBusy(nextBtn, false, 'Continue');

      if (!result || result.ok !== true) {
        toast('Could not add workspace: ' + ((result && result.error) || 'unknown error'), { variant: 'error' });
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
    content.appendChild(pathInput);
    content.appendChild(hint);
    content.appendChild(validation);
    content.appendChild(createdNote);
    nextBtn.onclick = submitWorkspace;
  } else if (step === 2) {
    nextBtn.textContent = 'Continue';
    content.innerHTML = '<h3 style="margin:0;font-size:15px;">How to ask for work</h3><p style="font-size:13px;color:var(--text-muted);line-height:1.5;">Tell ChatGPT which workspace alias to use, then ask for the smallest useful first step. For new repos, start with status and snapshot before requesting edits.</p><div class="empty" style="text-align:left;padding:12px;line-height:1.5;"><strong style="color:var(--text);">Good first prompt</strong><br><code>Use Rel.AI MCP on workspace "myapp". Call relai_git_status and relai_repo_snapshot. Do not modify files yet.</code></div>';
    nextBtn.onclick = async () => {
      _step++;
      _showStep();
    };
  } else if (step === 3) {
    nextBtn.textContent = 'Continue';
    content.innerHTML = '<h3 style="margin:0;font-size:15px;">Connect ChatGPT</h3><p style="font-size:13px;color:var(--text-muted);line-height:1.5;">Create a ChatGPT app, paste the MCP endpoint below, choose OAuth, and approve with your dashboard token. After that, select the Rel.AI MCP app in any chat.</p>';
    _withConnection(content, true);
  } else if (step === 4) {
    nextBtn.textContent = 'Done';
    skipBtn.style.display = 'none';
    backBtn.style.display = 'none';
    const workspaceLine = _data.workspaceCreated
      ? `Workspace <strong>${escapeHtml(_data.createdWorkspaceAlias)}</strong> is saved and ready.`
      : 'You can add a workspace later from the Workspaces page.';
    content.innerHTML = `<div style="text-align:center;padding:16px 0;display:grid;gap:12px;"><div style="font-size:32px;">✓</div><div style="font-size:16px;font-weight:700;">Setup complete</div><div style="color:var(--text-muted);font-size:13px;line-height:1.5;">${workspaceLine}<br>Select the Rel.AI MCP app in ChatGPT and ask for a read-only status check first.</div></div>`;
    nextBtn.onclick = async () => {
      await postJson('/api/onboarding/complete', { completed: true });
      const bd = document.getElementById('__relai-modal-backdrop');
      if (bd) bd.remove();
      toast('Setup complete — you can start using Rel.AI MCP now.', { variant: 'success' });
    };
  }
}

async function _withConnection(content, showCopy = false) {
  const conn = await fetchJson('/api/connection');
  if (!conn) return;
  if (showCopy && conn.chatgptMcpUrl) {
    const urlBox = document.createElement('div');
    urlBox.style.cssText = 'display:flex;gap:8px;align-items:center;';
    const code = document.createElement('code');
    code.style.cssText = 'flex:1;font-size:11px;word-break:break-all;padding:8px;background:var(--bg);border:1px solid var(--line-soft);border-radius:8px;';
    code.textContent = conn.chatgptMcpUrl;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'secondary';
    copyBtn.style.cssText = 'min-height:28px;padding:0 10px;font-size:12px;flex-shrink:0;';
    copyBtn.textContent = 'Copy';
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(conn.chatgptMcpUrl);
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
    };
    urlBox.appendChild(code);
    urlBox.appendChild(copyBtn);
    content.appendChild(urlBox);
    const appSteps = document.createElement('div');
    appSteps.className = 'setup-steps';
    appSteps.innerHTML = [
      'ChatGPT Settings > Apps > Create (or Workspace Settings > Apps > Create for admins).',
      'Paste this MCP endpoint and choose OAuth.',
      'Approve with your Rel.AI dashboard token, then select the app in chat.'
    ].map((step, index) => `<div class="step"><span class="step-num">${index + 1}</span><div>${escapeHtml(step)}</div></div>`).join('');
    content.appendChild(appSteps);
  }

  const status = document.createElement('div');
  status.style.cssText = 'font-size:12px;color:' + (conn.permanentUrlConfigured ? 'var(--green)' : 'var(--yellow)') + ';line-height:1.45;';
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

async function _next(nextBtn) {
  _step++;
  if (_step >= STEPS.length) _step = STEPS.length - 1;
  _showStep();
}

function _back() {
  _step = Math.max(0, _step - 1);
  _showStep();
}

async function _skip() {
  await postJson('/api/onboarding/complete', { completed: false, skipped: true });
  const bd = document.getElementById('__relai-modal-backdrop');
  if (bd) bd.remove();
  _showSkipBanner();
}

function _showSkipBanner() {
  const existing = document.getElementById('__onb-banner');
  if (existing) return;
  const banner = document.createElement('div');
  banner.id = '__onb-banner';
  banner.style.cssText = 'background:rgba(255,194,75,.08);border:1px solid rgba(255,194,75,.25);border-radius:10px;padding:10px 14px;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;';
  banner.innerHTML = '<span style="color:#ffe2a1;">Setup not complete</span>';
  const resumeBtn = document.createElement('button');
  resumeBtn.className = 'secondary';
  resumeBtn.style.cssText = 'min-height:26px;padding:0 10px;font-size:12px;';
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
  if (!result) {
    el.style.color = 'var(--text-muted)';
    el.textContent = '';
    return;
  }
  el.style.color = result.exists && result.isDirectory ? 'var(--green)' : 'var(--red)';
  if (result.exists && result.isDirectory) {
    el.textContent = result.isGit ? 'Path looks good. Git repository found.' : 'Path exists and can be added as a workspace.';
    return;
  }
  const finding = Array.isArray(result.findings) && result.findings.length ? result.findings[0].message : 'Folder not found.';
  el.textContent = finding;
}

function deriveAliasFromPath(workspacePath) {
  const clean = String(workspacePath || '').trim().replace(/[\\/]+$/, '');
  const leaf = clean.split(/[\\/]/).filter(Boolean).pop() || '';
  return leaf.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

function isValidAlias(alias) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(String(alias || ''));
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = label;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
