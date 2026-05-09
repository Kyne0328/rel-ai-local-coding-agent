// General settings sub-page — dirty tracking, diff summary, explicit save
import { openModal, closeModal } from '/ui/components/modal.js';
import { esc } from '/ui/utils.js';
import {
  loadSettingsConfig,
  saveSettings,
  header,
  formGrid,
  panel,
  field,
  selectControl,
  toggleControl,
  numberControl,
  saveRow
} from './shared.js';

let _original = null;
let _draft = null;
let _confirmedDangerous = false;

const DANGEROUS_KEYS = ['agentMode', 'trustedLocalAgent', 'allowArbitraryCommands', 'allowDestructiveTools', 'allowDocker', 'allowGitHubCli'];

export function mountGeneral(container) {
  container.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:13px;">Loading…</div>';
  _loadAndRender(container);
}

async function _loadAndRender(container) {
  const cfg = await loadSettingsConfig(container);
  if (!cfg) return;
  _original = JSON.parse(JSON.stringify(cfg));
  _draft = JSON.parse(JSON.stringify(cfg));
  _confirmedDangerous = false;
  _render(container);
}

function _render(container) {
  container.innerHTML = '';
  container.appendChild(header('General', 'Core server behavior, dashboard availability, and local UI preferences.'));

  const grid = formGrid();
  const server = panel('Server behavior');
  const limits = panel('Session limits');
  const local = panel('Local dashboard');

  server.body.appendChild(field('Tool mode', selectControl(['chatgpt_local_repo', 'simple', 'developer', 'debug'], _draft.toolMode || 'chatgpt_local_repo', (v) => { _draft.toolMode = v; _checkDirty(); }), 'ChatGPT local repo mode exposes only the small zip-like bridge tools; debug exposes every legacy/internal tool.'));
  server.body.appendChild(field('Permission profile', selectControl(['read-only', 'pr', 'test', 'admin'], _draft.permissionProfile, (v) => { _draft.permissionProfile = v; _checkDirty(); }), 'Legacy permission profile. Trusted local agent forces admin behavior.'));
  server.body.appendChild(field('Trusted local agent', toggleControl(_draft.trustedLocalAgent !== false, (v) => { _draft.trustedLocalAgent = v; _checkDirty(); }), 'One trust decision for ChatGPT-local use: unrestricted shell/write/reset within configured workspaces, no per-command approvals.'));
  server.body.appendChild(field('Default task mode', selectControl(['plan_only', 'implement', 'implement_and_test', 'review_only'], _draft.defaultTaskMode || 'implement_and_test', (v) => { _draft.defaultTaskMode = v; _checkDirty(); }), 'How new tasks are approached by default.'));
  server.body.appendChild(field('Sandbox mode', selectControl(['none', 'docker', 'docker_readonly_base'], _draft.sandboxMode || 'none', (v) => { _draft.sandboxMode = v; _checkDirty(); }), 'Execution isolation mode for tool and task runs.'));
  server.body.appendChild(field('Agent mode', toggleControl(_draft.agentMode, (v) => { _draft.agentMode = v; _checkDirty(); }), 'Convenience mode that enables full autonomous execution. Treat as high risk.'));

  limits.body.appendChild(field('Session locks', toggleControl(_draft.sessionLocksEnabled !== false, (v) => { _draft.sessionLocksEnabled = v; _checkDirty(); }), 'Prevent concurrent sessions on the same workspace.'));
  limits.body.appendChild(field('Max concurrent sessions per workspace', numberControl(_draft.maxConcurrentSessionsPerWorkspace, (v) => { _draft.maxConcurrentSessionsPerWorkspace = v; _checkDirty(); }, { min: 1, max: 50 }), 'Upper bound for simultaneous sessions per workspace.'));
  limits.body.appendChild(field('Max session steps', numberControl(_draft.maxSessionSteps, (v) => { _draft.maxSessionSteps = v; _checkDirty(); }, { min: 1, max: 100000 }), 'Hard cap for individual session loops.'));
  limits.body.appendChild(field('Max plan steps', numberControl(_draft.maxPlanSteps, (v) => { _draft.maxPlanSteps = v; _checkDirty(); }, { min: 1, max: 100000 }), 'Hard cap for planning loops.'));

  local.body.appendChild(field('Dashboard enabled', toggleControl(_draft.dashboardEnabled !== false, (v) => { _draft.dashboardEnabled = v; _checkDirty(); }), 'Disable to stop serving the dashboard.'));
  local.body.appendChild(field('Color theme', _themeToggle(), 'Stored only in this browser.'));

  grid.appendChild(server.el);
  grid.appendChild(limits.el);
  grid.appendChild(local.el);
  container.appendChild(grid);

  const save = saveRow(() => _save(container), () => _loadAndRender(container));
  save.id = '__settings-save-row';
  save.style.display = 'none';
  const changes = document.createElement('button');
  changes.className = 'secondary';
  changes.id = '__settings-changes-link';
  changes.style.cssText = 'font-size:12px;min-height:28px;padding:0 10px;';
  changes.onclick = () => _showDiffModal();
  save.prepend(changes);
  container.appendChild(save);
}

function _checkDirty() {
  const saveRowEl = document.getElementById('__settings-save-row');
  if (!saveRowEl) return;
  const changes = _getChanges();
  saveRowEl.style.display = changes.length ? 'flex' : 'none';
  const link = document.getElementById('__settings-changes-link');
  if (link) link.textContent = changes.length + ' change' + (changes.length === 1 ? '' : 's') + ' pending';
}

function _getChanges() {
  if (!_original || !_draft) return [];
  const changes = [];
  for (const key of Object.keys(_draft)) {
    if (JSON.stringify(_draft[key]) !== JSON.stringify(_original[key])) {
      changes.push({ key, oldValue: _original[key], newValue: _draft[key] });
    }
  }
  return changes;
}

function _showDiffModal() {
  const changes = _getChanges();
  const content = document.createElement('div');
  content.style.cssText = 'display:grid;gap:10px;font-size:13px;';
  for (const c of changes) {
    const row = document.createElement('div');
    row.style.cssText = 'padding:8px;border:1px solid var(--line-soft);border-radius:8px;background:var(--bg);';
    row.innerHTML = `<div style="font-weight:700;">${esc(c.key)}</div><div style="margin-top:4px;color:var(--red);font-size:12px;">- ${esc(JSON.stringify(c.oldValue))}</div><div style="color:var(--green);font-size:12px;">+ ${esc(JSON.stringify(c.newValue))}</div>`;
    content.appendChild(row);
  }
  openModal({ title: 'Pending changes', content });
}

async function _save(container) {
  const changes = _getChanges();
  const dangerous = changes.filter(c => DANGEROUS_KEYS.includes(c.key) && c.newValue === true && c.oldValue !== true);
  if (dangerous.length && !_confirmedDangerous) {
    _confirmedDangerous = await _confirmDangerous(dangerous);
    if (!_confirmedDangerous) return;
  }
  const res = await saveSettings(_draft, { confirmDangerous: _confirmedDangerous });
  if (res && res.ok) await _loadAndRender(container);
}

async function _confirmDangerous(dangerous) {
  return new Promise((resolve) => {
    const content = document.createElement('div');
    content.style.cssText = 'display:grid;gap:14px;font-size:13px;';
    content.innerHTML = `<p style="color:var(--yellow);">⚠ You are enabling high-risk settings: <strong>${dangerous.map(d => esc(d.key)).join(', ')}</strong>.</p><p>Type <code>DISABLE SAFETY</code> to confirm:</p>`;
    const input = document.createElement('input');
    input.type = 'text'; input.placeholder = 'DISABLE SAFETY'; input.style.cssText = 'width:100%;';
    const btn = document.createElement('button');
    btn.textContent = 'Confirm'; btn.disabled = true;
    const cancel = document.createElement('button');
    cancel.className = 'secondary'; cancel.textContent = 'Cancel';
    input.addEventListener('input', () => { btn.disabled = input.value !== 'DISABLE SAFETY'; });
    btn.onclick = () => { closeModal(); resolve(true); };
    cancel.onclick = () => { closeModal(); resolve(false); };
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;';
    row.appendChild(cancel); row.appendChild(btn);
    content.appendChild(input); content.appendChild(row);
    openModal({ title: 'Confirm dangerous change', content, escDisabled: false });
  });
}

function _themeToggle() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:8px;';
  const current = document.documentElement.dataset.theme || 'dark';
  for (const theme of ['dark', 'light']) {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.style.cssText = 'min-height:32px;padding:0 14px;font-size:13px;';
    btn.textContent = theme.charAt(0).toUpperCase() + theme.slice(1);
    if (current === theme) btn.style.background = 'rgba(78,161,255,.2)';
    btn.onclick = () => {
      if (theme === 'dark') {
        delete document.documentElement.dataset.theme;
        localStorage.setItem('relai_theme', 'dark');
      } else {
        document.documentElement.dataset.theme = 'light';
        localStorage.setItem('relai_theme', 'light');
      }
      wrap.querySelectorAll('button').forEach(b => { b.style.background = ''; });
      btn.style.background = 'rgba(78,161,255,.2)';
    };
    wrap.appendChild(btn);
  }
  return wrap;
}
