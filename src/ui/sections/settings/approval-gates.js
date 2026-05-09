import {
  loadSettingsConfig,
  saveSettings,
  header,
  formGrid,
  panel,
  field,
  toggleControl,
  saveRow
} from './shared.js';

let _draft = null;

const LABELS = {
  commit: 'Commit',
  push: 'Push',
  pr: 'Pull request',
  reset: 'Reset',
  'worktree-remove': 'Remove worktree',
  docker: 'Docker',
  command: 'Command',
  patch: 'Patch',
  write: 'Write file',
  merge: 'Merge'
};

export function mountApprovalGates(container) {
  container.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:13px;">Loading…</div>';
  _load(container);
}

async function _load(container) {
  const cfg = await loadSettingsConfig(container);
  if (!cfg) return;
  _draft = JSON.parse(JSON.stringify(cfg.approvalGates || {}));
  _render(container, cfg);
}

function _render(container, cfg) {
  container.innerHTML = '';
  container.appendChild(header('Approval Gates', 'Choose which sensitive actions require explicit dashboard approval.'));
  if (cfg.agentMode) {
    const warn = document.createElement('div');
    warn.className = 'empty';
    warn.style.cssText = 'padding:12px;margin-bottom:12px;text-align:left;color:var(--yellow);';
    warn.textContent = 'Agent mode is enabled. Config normalization forces approval gates off while agentMode remains true.';
    container.appendChild(warn);
  }

  const grid = formGrid();
  const gates = panel('Gates');
  const keys = Object.keys({ ...LABELS, ..._draft });
  for (const key of keys) {
    gates.body.appendChild(field(LABELS[key] || key, toggleControl(Boolean(_draft[key]), (v) => { _draft[key] = v; }, { enabled: 'Requires approval', disabled: 'No approval' }), `approvalGates.${key}`));
  }
  grid.appendChild(gates.el);
  container.appendChild(grid);
  container.appendChild(saveRow(() => _save(container), () => _load(container)));
}

async function _save(container) {
  const res = await saveSettings({ approvalGates: _draft });
  if (res && res.ok) await _load(container);
}
