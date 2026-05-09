import {
  loadSettingsConfig,
  saveSettings,
  header,
  formGrid,
  panel,
  field,
  toggleControl,
  numberControl,
  textAreaControl,
  saveRow,
  settingsTable
} from './shared.js';

let _draft = null;

export function mountAdvanced(container) {
  container.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:13px;">Loading…</div>';
  _load(container);
}

async function _load(container) {
  const cfg = await loadSettingsConfig(container);
  if (!cfg) return;
  _draft = JSON.parse(JSON.stringify(cfg));
  _render(container);
}

function _render(container) {
  container.innerHTML = '';
  container.appendChild(header('Advanced', 'Tune multi-agent orchestration, task runner, product UX, release, memory, and indexing settings.'));

  const grid = formGrid();
  const multi = panel('Multi-agent');
  _draft.multiAgent = _draft.multiAgent || {};
  multi.body.appendChild(field('Enabled', toggleControl(_draft.multiAgent.enabled, (v) => { _draft.multiAgent.enabled = v; }), 'Enable delegated subtasks.'));
  multi.body.appendChild(field('Max subtasks', numberControl(_draft.multiAgent.maxSubtasks, (v) => { _draft.multiAgent.maxSubtasks = v; }, { min: 1, max: 50 }), 'Total subtasks per parent task.'));
  multi.body.appendChild(field('Max parallel subtasks', numberControl(_draft.multiAgent.maxParallelSubtasks, (v) => { _draft.multiAgent.maxParallelSubtasks = v; }, { min: 1, max: 20 }), 'Concurrent subtasks.'));
  multi.body.appendChild(field('Require review before merge', toggleControl(_draft.multiAgent.requireReviewBeforeMerge, (v) => { _draft.multiAgent.requireReviewBeforeMerge = v; }), 'Keep merge decisions gated by reviewer role.'));
  multi.body.appendChild(field('Default roles', textAreaControl(_draft.multiAgent.defaultRoles || [], (v) => { _draft.multiAgent.defaultRoles = v; }, 4), 'One role per line or comma-separated.'));

  const runner = panel('Task runner');
  _draft.taskRunner = _draft.taskRunner || {};
  runner.body.appendChild(field('Max cycles', numberControl(_draft.taskRunner.maxCycles, (v) => { _draft.taskRunner.maxCycles = v; }, { min: 1, max: 50 }), 'Maximum automated task cycles.'));
  runner.body.appendChild(field('Require worktree', toggleControl(_draft.taskRunner.requireWorktree, (v) => { _draft.taskRunner.requireWorktree = v; }), 'Prefer isolated worktrees for tasks.'));
  runner.body.appendChild(field('Approval before commit', toggleControl(_draft.taskRunner.requireApprovalBeforeCommit, (v) => { _draft.taskRunner.requireApprovalBeforeCommit = v; }), 'Gate commits created by task runner.'));
  runner.body.appendChild(field('Approval before push', toggleControl(_draft.taskRunner.requireApprovalBeforePush, (v) => { _draft.taskRunner.requireApprovalBeforePush = v; }), 'Gate pushes created by task runner.'));
  runner.body.appendChild(field('Approval before PR', toggleControl(_draft.taskRunner.requireApprovalBeforePr, (v) => { _draft.taskRunner.requireApprovalBeforePr = v; }), 'Gate PR creation.'));

  const ux = panel('Product UX and release');
  _draft.productUx = _draft.productUx || {};
  _draft.release = _draft.release || {};
  ux.body.appendChild(field('Dashboard refresh seconds', numberControl(_draft.productUx.dashboardRefreshSeconds, (v) => { _draft.productUx.dashboardRefreshSeconds = v; }, { min: 1, max: 3600 }), 'Polling interval.'));
  ux.body.appendChild(field('Live log poll seconds', numberControl(_draft.productUx.liveLogPollSeconds, (v) => { _draft.productUx.liveLogPollSeconds = v; }, { min: 1, max: 3600 }), 'Fallback polling for logs.'));
  ux.body.appendChild(field('Stale hours', numberControl(_draft.productUx.staleHours, (v) => { _draft.productUx.staleHours = v; }, { min: 1, max: 10000 }), 'When dashboard entries are considered stale.'));
  ux.body.appendChild(field('Minimum readiness score', numberControl(_draft.release.minimumReadinessScore, (v) => { _draft.release.minimumReadinessScore = v; }, { min: 0, max: 100 }), 'Release readiness threshold.'));
  ux.body.appendChild(field('Require HTTP token', toggleControl(_draft.release.requireHttpToken, (v) => { _draft.release.requireHttpToken = v; }), 'Require token for HTTP release endpoints.'));
  ux.body.appendChild(field('Enable release endpoints', toggleControl(_draft.release.enableReleaseEndpoints, (v) => { _draft.release.enableReleaseEndpoints = v; }), 'Expose release helper endpoints.'));

  const info = panel('Current paths');
  info.body.appendChild(settingsTable({ configPath: _draft.configPath, stateDir: _draft.stateDir, auditLogPath: _draft.auditLogPath, worktreeRoot: _draft.worktreeRoot }));

  grid.appendChild(multi.el);
  grid.appendChild(runner.el);
  grid.appendChild(ux.el);
  grid.appendChild(info.el);
  container.appendChild(grid);
  container.appendChild(saveRow(() => _save(container), () => _load(container)));
}

async function _save(container) {
  const res = await saveSettings({
    multiAgent: _draft.multiAgent,
    taskRunner: _draft.taskRunner,
    productUx: _draft.productUx,
    release: _draft.release
  });
  if (res && res.ok) await _load(container);
}
