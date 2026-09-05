import { fetchJson, postJson } from '../../api.js';
import { confirmAction } from '../../components/confirm-dialog.js';
import { esc } from '../../utils.js';
import { header, panel, toggleControl, toggleRow } from './shared.js';

export function mountLearning(container) {
  container.innerHTML = '<div class="settings-loading">Loading learning…</div>';
  return loadAndRender(container);
}

async function loadAndRender(container) {
  try {
    const data = await fetchJson('/api/learning', { cache: 'no-store' });
    if (!data?.ok) throw new Error(data?.error || 'Learning is unavailable.');

    container.innerHTML = '';
    container.appendChild(header(
      'Learning',
      'Manage reusable skills ChatGPT explicitly saves through Rel.AI.'
    ));
    const status = document.createElement('p');
    status.className = 'settings-help settings-learning-status';
    status.dataset.learningStatus = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    container.appendChild(status);
    container.appendChild(learningPanel(container, data).el);
    container.appendChild(advancedPanel(container).el);
  } catch (error) {
    container.innerHTML = '';
    container.appendChild(header('Learning', 'Manage reusable skills ChatGPT saves through Rel.AI.'));
    const unavailable = panel('Learning unavailable');
    unavailable.body.innerHTML = `<p class="settings-help">${esc(error instanceof Error ? error.message : 'Learning is unavailable.')}</p>`;
    container.appendChild(unavailable.el);
  }
}

function learningPanel(container, data) {
  const section = panel('Agent learning');
  section.body.appendChild(toggleRow(
    'Agent-managed learning',
    toggleControl(data.settings?.proceduralLearning !== false, value => { void updateSettings(container, { proceduralLearning: value }); }),
    'Allow ChatGPT to save or update reusable skills through Rel.AI while it is actively working.'
  ));

  const explanation = document.createElement('div');
  explanation.className = 'settings-learning-explanation';
  explanation.innerHTML = '<strong>ChatGPT decides what to learn</strong><span>When current work proves a useful, non-trivial workflow, ChatGPT can save a reusable SKILL.md through Rel.AI. Rel.AI validates ownership, project scope, skill format, and current task evidence. It does not guess from task similarity or run another model after the ChatGPT turn ends.</span>';
  section.body.appendChild(explanation);

  const skills = Array.isArray(data.managedSkills) ? data.managedSkills : [];
  const total = Number(data.learnedSkillCount || skills.length);
  section.body.appendChild(sectionHeading('Learned skills', total, shownCount(skills.length, total)));
  const list = document.createElement('div');
  list.className = 'settings-learning-list';
  if (!skills.length) list.appendChild(emptyText('No learned skills yet. ChatGPT can create one after a task establishes a reusable workflow.'));
  else for (const skill of skills) list.insertAdjacentHTML('beforeend', learnedSkillRow(skill));
  section.body.appendChild(list);
  bindSkillActions(container, section.body);
  return section;
}

function advancedPanel(container) {
  const section = panel('Advanced');
  const row = document.createElement('div');
  row.className = 'setting-row settings-learning-clear-row';
  row.innerHTML = '<div class="setting-row-copy"><strong>Clear learned data</strong><span>Remove learned validation mappings and Rel.AI-managed learned skills.</span></div><button type="button" class="secondary danger" data-clear-learning>Clear…</button>';
  section.body.appendChild(row);

  row.querySelector('[data-clear-learning]').addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Clear learned data',
      message: 'Clear Rel.AI learned data?',
      detail: 'This removes learned validation mappings and Rel.AI-managed learned skills. Project files and manually created skills are not removed.',
      confirmLabel: 'Clear learned data',
      danger: true
    });
    if (!confirmed) return;
    const result = await postJson('/api/learning', { action: 'clear', confirm: true }).catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    if (!result?.ok) {
      setStatus(container, result?.error || 'Could not clear learned data.');
      return;
    }
    await loadAndRender(container);
  });
  return section;
}

function bindSkillActions(container, root) {
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-skill]');
    if (!button) return;
    const confirmed = await confirmAction({
      title: 'Forget learned skill',
      message: `Forget ${button.dataset.deleteSkill}?`,
      detail: 'Rel.AI removes only this agent-managed learned skill. Manually created project and user skills are not changed.',
      confirmLabel: 'Forget skill',
      danger: true
    });
    if (!confirmed) return;
    button.disabled = true;
    const result = await postJson('/api/learning', {
      action: 'delete_skill',
      name: button.dataset.deleteSkill,
      scope: button.dataset.skillScope,
      workspace: button.dataset.skillWorkspace || ''
    }).catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    if (!result?.ok) {
      button.disabled = false;
      setStatus(container, result?.error || 'Could not remove learned skill.');
      return;
    }
    await loadAndRender(container);
  });
}

async function updateSettings(container, patch) {
  const result = await postJson('/api/learning', { action: 'settings', ...patch })
    .catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  if (!result?.ok) {
    setStatus(container, result?.error || 'Could not save learning settings.');
    return;
  }
  await loadAndRender(container);
}

function sectionHeading(title, count, note = null) {
  const heading = document.createElement('div');
  heading.className = 'settings-learning-section-head';
  heading.innerHTML = `<div><strong>${esc(title)}</strong><span class="settings-count">${Number(count || 0)}</span></div>`;
  if (note) heading.appendChild(note);
  return heading;
}

function shownCount(shown, total) {
  if (shown >= total) return null;
  const note = document.createElement('span');
  note.className = 'settings-list-count';
  note.textContent = `${shown} of ${total} shown`;
  return note;
}

function learnedSkillRow(skill) {
  const scope = skill.scope === 'workspace' ? `Project: ${skill.workspace || 'current project'}` : 'All projects';
  return `<div class="settings-learning-row">
    <div>
      <span class="settings-skill-title">${esc(skillTitle(skill.name))}</span>
      ${skill.description ? `<small>${esc(skill.description)}</small>` : ''}
      <small>${esc(scope)}</small>
    </div>
    <button type="button" class="secondary compact-button" data-delete-skill="${esc(skill.name)}" data-skill-scope="${esc(skill.scope || 'workspace')}" data-skill-workspace="${esc(skill.workspace || '')}">Forget</button>
  </div>`;
}

function skillTitle(value) {
  const text = String(value || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Learned skill';
}

function emptyText(text) {
  const element = document.createElement('p');
  element.className = 'settings-help settings-learning-empty';
  element.textContent = text;
  return element;
}

function setStatus(container, message) {
  const status = container.querySelector('[data-learning-status]');
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
}
