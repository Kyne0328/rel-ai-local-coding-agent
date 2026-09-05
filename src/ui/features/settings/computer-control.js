import { fetchJson, postJson } from '../../api.js';
import { toast } from '../../components/toast.js';
import { panel, toggleControl, toggleRow } from './shared.js';

export async function computerControlPanel() {
  const section = panel('Computer control');
  const data = await fetchJson('/api/computer', { cache: 'no-store' });
  const enabled = data?.settings?.enabled === true;
  const available = data?.status?.available === true;
  const help = available
    ? 'Allow ChatGPT connected through Rel.AI to view and control this computer. Operating-system permissions and privilege boundaries still apply.'
    : `Desktop automation is unavailable on this installation${data?.status?.message ? `: ${data.status.message}` : '.'}`;
  const toggle = toggleControl(enabled, value => updateComputerControl(toggle, value), {
    enabled: 'Allowed',
    disabled: 'Off'
  });
  const input = toggle.querySelector('input');
  if (input && !available) input.disabled = true;
  section.body.appendChild(toggleRow('Allow computer control', toggle, help));
  return section.el;
}

async function updateComputerControl(control, enabled) {
  const input = control.querySelector('input');
  if (input) input.disabled = true;
  const result = await postJson('/api/computer', { enabled }, { cache: 'no-store' });
  if (input) input.disabled = false;
  if (!result?.ok) {
    if (input) input.checked = !enabled;
    toast(result?.error || 'Could not save computer control settings.', { variant: 'error' });
    return;
  }
  toast(enabled ? 'Computer control is enabled.' : 'Computer control is disabled.', { variant: 'success' });
}
