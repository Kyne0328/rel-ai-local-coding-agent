import { fetchJson, postJson } from '../../api.js';
import { confirmAction } from '../../components/confirm-dialog.js';
import { get as getStore } from '../../store.js';
import { esc } from '../../utils.js';
import { header, panel, toggleControl, toggleRow } from './shared.js';

export function mountKnowledge(container) {
  container.innerHTML = '<div class="settings-loading">Loading memory & learning…</div>';
  return loadAndRender(container);
}

async function loadAndRender(container) {
  try {
    const data = await fetchJson('/api/knowledge', { cache: 'no-store' });
    if (!data?.ok) throw new Error(data?.error || 'Memory is unavailable.');

    container.innerHTML = '';
    container.appendChild(header(
      'Memory & learning',
      'Manage local memories and reusable skills ChatGPT saves through Rel.AI.'
    ));
    const status = document.createElement('p');
    status.className = 'settings-help settings-memory-status';
    status.dataset.memoryStatus = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    container.appendChild(status);
    container.appendChild(memoryPanel(container, data).el);
    container.appendChild(learningPanel(container, data).el);
    container.appendChild(advancedPanel(container).el);
  } catch (error) {
    container.innerHTML = '';
    container.appendChild(header('Memory & learning', 'Manage local memories and reusable skills.'));
    const unavailable = panel('Memory unavailable');
    unavailable.body.innerHTML = `<p class="settings-help">${esc(error instanceof Error ? error.message : 'Memory is unavailable.')}</p>`;
    container.appendChild(unavailable.el);
  }
}

function memoryPanel(container, data) {
  const section = panel('Memory');
  section.body.appendChild(toggleRow(
    'Long-term memory',
    toggleControl(data.settings?.enabled !== false, value => { void updateSettings(container, { enabled: value }); }),
    'Use relevant facts and preferences saved for all projects or for one project when new Rel.AI work starts.'
  ));

  const privacy = document.createElement('p');
  privacy.className = 'settings-help settings-memory-privacy';
  privacy.textContent = 'Memory stays on this computer. Rel.AI can correlate its own work from the same ChatGPT conversation, but it does not receive the full ChatGPT transcript.';
  section.body.appendChild(privacy);
  section.body.appendChild(memoryForm(container));

  const items = Array.isArray(data.items) ? data.items : [];
  section.body.appendChild(sectionHeading('Saved memory', Number(data.knowledgeCount || 0), shownCount(items.length, Number(data.knowledgeCount || 0))));
  const list = document.createElement('div');
  list.className = 'settings-memory-list';
  if (!items.length) list.appendChild(emptyText('No saved memories yet.'));
  else for (const item of items) list.insertAdjacentHTML('beforeend', memoryRow(item));
  section.body.appendChild(list);
  bindMemoryActions(container, section.body);
  return section;
}

function memoryForm(container) {
  const form = document.createElement('form');
  form.className = 'settings-memory-form';
  form.method = 'post';
  form.innerHTML = `
    <label class="settings-memory-field settings-memory-fact-field">
      <span>Fact or preference</span>
      <input type="text" name="content" maxlength="4000" placeholder="Example: Use pnpm for this project" required>
    </label>
    <label class="settings-memory-field">
      <span>Available to</span>
      <select name="workspace"><option value="">All projects</option></select>
    </label>
    <button type="submit" class="secondary settings-memory-add">Add memory</button>`;

  const project = form.elements.workspace;
  const aliases = (Array.isArray(getStore().config?.workspaces) ? getStore().config.workspaces : [])
    .map(workspace => String(workspace?.alias || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'en-US', { numeric: true, sensitivity: 'base' }));
  project.insertAdjacentHTML('beforeend', aliases.map(alias => `<option value="${esc(alias)}">${esc(alias)}</option>`).join(''));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const workspace = String(project.value || '');
    const result = await postJson('/api/knowledge', {
      action: 'add',
      content: String(form.elements.content.value || '').trim(),
      scope: workspace ? 'workspace' : 'global',
      workspace
    }).catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    if (!result?.ok) {
      setStatus(container, result?.error || 'Could not save memory.');
      return;
    }
    await loadAndRender(container);
  });
  return form;
}

function learningPanel(container, data) {
  const section = panel('Learning');
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
  list.className = 'settings-memory-list';
  if (!skills.length) list.appendChild(emptyText('No learned skills yet. ChatGPT can create one after a task establishes a reusable workflow.'));
  else for (const skill of skills) list.insertAdjacentHTML('beforeend', learnedSkillRow(skill));
  section.body.appendChild(list);
  bindSkillActions(container, section.body);
  return section;
}

function advancedPanel(container) {
  const section = panel('Advanced');
  const row = document.createElement('div');
  row.className = 'setting-row settings-memory-clear-row';
  row.innerHTML = '<div class="setting-row-copy"><strong>Clear memory & learning</strong><span>Remove all saved memories, learned validation mappings, and Rel.AI-managed learned skills.</span></div><button type="button" class="secondary danger" data-clear-memory>Clear…</button>';
  section.body.appendChild(row);

  row.querySelector('[data-clear-memory]').addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Clear memory & learning',
      message: 'Clear all local memory and learned skills?',
      detail: 'This removes saved memories, learned validation mappings, and Rel.AI-managed learned skills. Project files and manually created skills are not removed.',
      confirmLabel: 'Clear memory & learning',
      danger: true
    });
    if (!confirmed) return;
    const result = await postJson('/api/knowledge', { action: 'clear', confirm: true }).catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    if (!result?.ok) {
      setStatus(container, result?.error || 'Could not clear memory & learning.');
      return;
    }
    await loadAndRender(container);
  });
  return section;
}

function bindMemoryActions(container, root) {
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-memory]');
    if (!button) return;
    button.disabled = true;
    const result = await postJson('/api/knowledge', { action: 'delete', id: button.dataset.deleteMemory })
      .catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    if (!result?.ok) {
      button.disabled = false;
      setStatus(container, result?.error || 'Could not remove memory.');
      return;
    }
    await loadAndRender(container);
  });
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
    const result = await postJson('/api/knowledge', {
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
  const result = await postJson('/api/knowledge', { action: 'settings', ...patch })
    .catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  if (!result?.ok) {
    setStatus(container, result?.error || 'Could not save memory settings.');
    return;
  }
  await loadAndRender(container);
}

function sectionHeading(title, count, note = null) {
  const heading = document.createElement('div');
  heading.className = 'settings-memory-section-head';
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

function memoryRow(item) {
  return `<div class="settings-memory-row">
    <div><span>${esc(item.content)}</span><small>${esc(item.scope === 'workspace' ? `Project: ${item.workspace}` : 'All projects')}</small></div>
    <button type="button" class="secondary compact-button" data-delete-memory="${esc(item.id)}">Remove</button>
  </div>`;
}

function learnedSkillRow(skill) {
  const scope = skill.scope === 'workspace' ? `Project: ${skill.workspace || 'current project'}` : 'All projects';
  return `<div class="settings-memory-row settings-procedure-row">
    <div>
      <span class="settings-procedure-title">${esc(skillTitle(skill.name))}</span>
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
  element.className = 'settings-help settings-memory-empty';
  element.textContent = text;
  return element;
}

function setStatus(container, message) {
  const status = container.querySelector('[data-memory-status]');
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
}
