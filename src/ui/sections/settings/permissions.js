import {
  loadSettingsConfig,
  saveSettings,
  header,
  formGrid,
  panel,
  field,
  selectControl,
  toggleControl,
  saveRow
} from './shared.js';

let _draft = null;
let _original = null;

export function mountPermissions(container) {
  container.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:13px;">Loading…</div>';
  _load(container);
}

async function _load(container) {
  const cfg = await loadSettingsConfig(container);
  if (!cfg) return;
  _original = JSON.parse(JSON.stringify(cfg));
  _draft = JSON.parse(JSON.stringify(cfg));
  _render(container);
}

function _render(container) {
  container.innerHTML = '';
  container.appendChild(header('Permissions', 'Control global capabilities. High-risk switches require explicit confirmation when saved.'));
  const grid = formGrid();

  const profile = panel('Access profile');
  profile.body.appendChild(field('Tool mode', selectControl(['chatgpt_local_repo', 'simple', 'developer', 'debug'], _draft.toolMode || 'chatgpt_local_repo', (v) => { _draft.toolMode = v; }), 'ChatGPT local repo mode exposes only the small bridge API. Debug exposes legacy/internal tools.'));
  profile.body.appendChild(field('Permission profile', selectControl(['read-only', 'pr', 'test', 'admin'], _draft.permissionProfile || 'admin', (v) => { _draft.permissionProfile = v; }), 'Legacy profile. Trusted local agent mode forces admin behavior.'));
  profile.body.appendChild(field('Sandbox mode', selectControl(['none', 'docker', 'docker_readonly_base'], _draft.sandboxMode || 'none', (v) => { _draft.sandboxMode = v; }), 'Docker modes only work when Docker is available and enabled.'));

  const caps = panel('Capabilities');
  caps.body.appendChild(field('Trusted local agent', toggleControl(_draft.trustedLocalAgent !== false, (v) => { _draft.trustedLocalAgent = v; }), 'One trust decision for ChatGPT-local use. Removes per-command approvals and allows unrestricted shell/write/reset inside workspaces.'));
  caps.body.appendChild(field('Agent mode', toggleControl(_draft.agentMode, (v) => { _draft.agentMode = v; }), 'Legacy convenience mode that enables admin, arbitrary commands, and permissive approval settings.'));
  caps.body.appendChild(field('GitHub CLI', toggleControl(_draft.allowGitHubCli, (v) => { _draft.allowGitHubCli = v; }), 'Allow use of the GitHub CLI from tools.'));
  caps.body.appendChild(field('Docker', toggleControl(_draft.allowDocker, (v) => { _draft.allowDocker = v; }), 'Allow Docker-backed execution where supported.'));
  caps.body.appendChild(field('Arbitrary commands', toggleControl(_draft.allowArbitraryCommands, (v) => { _draft.allowArbitraryCommands = v; }), 'Allow command strings beyond configured command keys.'));
  caps.body.appendChild(field('Destructive tools', toggleControl(_draft.allowDestructiveTools, (v) => { _draft.allowDestructiveTools = v; }), 'Allow operations that can remove or reset state.'));

  grid.appendChild(profile.el);
  grid.appendChild(caps.el);
  container.appendChild(grid);
  container.appendChild(saveRow(() => _save(container), () => _load(container)));
}

async function _save(container) {
  const highRisk = ['agentMode', 'trustedLocalAgent', 'allowGitHubCli', 'allowDocker', 'allowArbitraryCommands', 'allowDestructiveTools'];
  const enabled = highRisk.filter(k => _draft[k] === true && (!_original || _original[k] !== true));
  if (enabled.length && !window.confirm('Enable high-risk settings: ' + enabled.join(', ') + '?')) return;
  const res = await saveSettings({
    toolMode: _draft.toolMode,
    permissionProfile: _draft.permissionProfile,
    sandboxMode: _draft.sandboxMode,
    trustedLocalAgent: _draft.trustedLocalAgent,
    agentMode: _draft.agentMode,
    allowGitHubCli: _draft.allowGitHubCli,
    allowDocker: _draft.allowDocker,
    allowArbitraryCommands: _draft.allowArbitraryCommands,
    allowDestructiveTools: _draft.allowDestructiveTools
  }, { confirmDangerous: true });
  if (res && res.ok) await _load(container);
}
