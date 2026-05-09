// Onboarding wizard — 5-step modal carousel
import { fetchJson, postJson } from '/ui/api.js';
import { closeModal } from '/ui/components/modal.js';
import { toast } from '/ui/components/toast.js';

let _step = 0;
let _data = {};
const STEPS = ['Welcome', 'Add workspace', 'Pick profile', 'Connect ChatGPT', 'Done'];

export function openOnboarding() {
  _step = 0;
  _data = {};
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
  dialog.style.cssText = 'background:var(--surface);border:1px solid var(--line-soft);border-radius:16px;padding:32px;max-width:520px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.5);display:grid;gap:20px;';

  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
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
  footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
  const skipBtn = document.createElement('button');
  skipBtn.className = 'secondary';
  skipBtn.style.cssText = 'font-size:12px;min-height:28px;color:var(--text-muted);';
  skipBtn.textContent = 'Skip for now';
  skipBtn.onclick = _skip;

  const nextBtn = document.createElement('button');
  nextBtn.textContent = _step === STEPS.length - 1 ? 'Done' : 'Continue →';
  nextBtn.onclick = () => _next(nextBtn);

  footer.appendChild(skipBtn);
  footer.appendChild(nextBtn);

  dialog.appendChild(hdr);
  dialog.appendChild(content);
  dialog.appendChild(footer);
  bd.appendChild(dialog);
  document.body.appendChild(bd);
  nextBtn.focus();

  _renderStep(_step, content, nextBtn, skipBtn);
}

function _renderStep(step, content, nextBtn, skipBtn) {
  if (step === 0) {
    content.innerHTML = '<p style="font-size:14px;">Welcome to Rel.AI MCP. This setup will connect your workspaces and ChatGPT.</p>';
    _withConnection(content);
  } else if (step === 1) {
    content.innerHTML = '<h3 style="margin:0;font-size:15px;">Add your first workspace</h3><p style="font-size:13px;color:var(--text-muted);">A workspace is a folder that Rel.AI reads and edits. Each workspace is isolated.</p>';
    const aliasInput = document.createElement('input');
    aliasInput.type = 'text'; aliasInput.placeholder = 'Alias (short name, e.g. acme)';
    aliasInput.style.cssText = 'width:100%;';
    const pathInput = document.createElement('input');
    pathInput.type = 'text'; pathInput.placeholder = 'Folder path (absolute, e.g. /Users/you/code/acme)';
    pathInput.style.cssText = 'width:100%;';
    const validation = document.createElement('div');
    validation.style.cssText = 'font-size:12px;color:var(--text-muted);';
    let validTimer;
    pathInput.addEventListener('input', () => {
      clearTimeout(validTimer);
      validTimer = setTimeout(async () => {
        const p = pathInput.value.trim();
        if (!p) { validation.textContent = ''; return; }
        validation.textContent = 'Checking…';
        const res = await fetchJson('/api/workspace/preflight?path=' + encodeURIComponent(p));
        validation.style.color = (res && res.exists) ? 'var(--green)' : 'var(--red)';
        validation.textContent = res ? (res.exists ? '✓ ' + (res.isGit ? 'git repository' : 'folder exists') : '✗ folder not found') : '✗ validation failed';
      }, 400);
    });
    content.appendChild(aliasInput);
    content.appendChild(pathInput);
    content.appendChild(validation);
    nextBtn.onclick = async () => {
      _data.workspaceAlias = aliasInput.value.trim();
      _data.workspacePath = pathInput.value.trim();
      if (!_data.workspaceAlias || !_data.workspacePath) { toast('Enter both alias and path.', { variant: 'warn' }); return; }
      _step++; _showStep();
    };
  } else if (step === 2) {
    content.innerHTML = '<h3 style="margin:0;font-size:15px;">Trusted local bridge</h3><p style="font-size:13px;color:var(--text-muted);line-height:1.5;">Rel.AI is now designed for one thing: connect ChatGPT to your local repo like an uploaded zip, with local shell, write, verify, diff, and reset access inside configured workspaces.</p><div class="empty" style="text-align:left;padding:12px;">No permission profile setup is needed. Approval gates and command allowlists are not part of the normal ChatGPT-local workflow.</div>';
    nextBtn.onclick = async () => { _data.profile = 'admin'; _step++; _showStep(); };
  } else if (step === 3) {
    content.innerHTML = '<h3 style="margin:0;font-size:15px;">Connect ChatGPT</h3>';
    _withConnection(content, true);
  } else if (step === 4) {
    content.innerHTML = '<div style="text-align:center;padding:16px 0;display:grid;gap:12px;"><div style="font-size:32px;">✓</div><div style="font-size:16px;font-weight:700;">Setup complete</div><div style="color:var(--text-muted);font-size:13px;">Rel.AI MCP is ready. Ask ChatGPT to read a file in your workspace to get started.</div></div>';
    skipBtn.style.display = 'none';
    nextBtn.onclick = async () => {
      await postJson('/api/onboarding/complete', { completed: true });
      const bd = document.getElementById('__relai-modal-backdrop');
      if (bd) bd.remove();
      toast('Setup complete — press Cmd-K anytime.', { variant: 'success' });
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
    copyBtn.onclick = async () => { await navigator.clipboard.writeText(conn.chatgptMcpUrl); copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000); };
    urlBox.appendChild(code);
    urlBox.appendChild(copyBtn);
    content.appendChild(urlBox);
  }
  const status = document.createElement('div');
  status.style.cssText = 'font-size:12px;color:' + (conn.permanentUrlConfigured ? 'var(--green)' : 'var(--yellow)') + ';';
  status.textContent = conn.permanentUrlConfigured ? '✓ Permanent URL configured' : '⚠ No permanent URL — chatgpt connection may be unstable';
  content.appendChild(status);
}

async function _next(nextBtn) {
  _step++;
  if (_step >= STEPS.length) { _step = STEPS.length - 1; }
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
  banner.innerHTML = '<span style="color:#ffe2a1;">⚠ Setup not complete</span>';
  const resumeBtn = document.createElement('button');
  resumeBtn.className = 'secondary';
  resumeBtn.style.cssText = 'min-height:26px;padding:0 10px;font-size:12px;';
  resumeBtn.textContent = 'Resume setup';
  resumeBtn.onclick = openOnboarding;
  banner.appendChild(resumeBtn);
  const main = document.getElementById('main');
  if (main) main.prepend(banner);
}
