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
      'Manage local memories and reusable workflows Rel.AI learns from completed work.'
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
    container.appendChild(header('Memory & learning', 'Manage local memories and reusable workflows.'));
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
  const heading = sectionHeading('Saved memory', Number(data.knowledgeCount || 0), shownCount(items.length, Number(data.knowledgeCount || 0)));
  section.body.appendChild(heading);
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
      <select name="scope">
        <option value="global">All projects</option>
        <option value="workspace">One project</option>
      </select>
    </label>
    <label class="settings-memory-field" data-memory-project hidden>
      <span>Project</span>
      <select name="workspace"></select>
    </label>
    <button type="submit" class="secondary settings-memory-add">Add memory</button>`;

  const scope = form.elements.scope;
  const projectField = form.querySelector('[data-memory-project]');
  const project = form.elements.workspace;
  const aliases = Object.keys(getStore().config?.workspaces || {}).sort((a, b) => a.localeCompare(b));
  project.innerHTML = aliases.length
    ? aliases.map(alias => `<option value="${esc(alias)}">${esc(alias)}</option>`).join('')
    : '<option value="">No projects configured</option>';

  const syncScope = () => {
    const oneProject = scope.value === 'workspace';
    projectField.hidden = !oneProject;
    project.required = oneProject;
    project.disabled = !oneProject || aliases.length === 0;
  };
  scope.addEventListener('change', syncScope);
  syncScope();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const result = await postJson('/api/knowledge', {
      action: 'add',
      content: String(form.elements.content.value || '').trim(),
      scope: scope.value,
      workspace: scope.value === 'workspace' ? String(project.value || '') : ''
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
    'Learn from completed work',
    toggleControl(data.settings?.proceduralLearning !== false, value => { void updateSettings(container, { proceduralLearning: value }); }),
    'Learn reusable workflows only from explicitly completed work with authoritative evidence.'
  ));

  const explanation = document.createElement('div');
  explanation.className = 'settings-learning-explanation';
  explanation.innerHTML = '<strong>Learning is automatic</strong><span>The first matching success is kept as an observed pattern and is not reused yet. After a second independent successful run, Rel.AI learns the workflow and maintains a reusable local skill automatically. No approval is required.</span>';
  section.body.appendChild(explanation);

  const procedures = Array.isArray(data.procedures) ? data.procedures : [];
  const observed = procedures.filter(item => item.status === 'candidate');
  const learned = procedures.filter(item => item.status === 'verified');
  const stale = procedures.filter(item => item.status === 'superseded');

  const observedDisclosure = document.createElement('details');
  observedDisclosure.className = 'settings-disclosure settings-observed-procedures';
  observedDisclosure.innerHTML = `<summary><span>Observed patterns</span><span class="settings-count">${Number(data.candidateCount || 0)}</span></summary>`;
  const observedBody = document.createElement('div');
  observedBody.className = 'settings-memory-list';
  if (!observed.length) observedBody.appendChild(emptyText('No observed patterns waiting for more evidence.'));
  else {
    for (const item of observed) observedBody.insertAdjacentHTML('beforeend', procedureRow(item, 'observed'));
    const count = shownCount(observed.length, Number(data.candidateCount || 0));
    if (count) observedBody.appendChild(count);
  }
  observedDisclosure.appendChild(observedBody);
  section.body.appendChild(observedDisclosure);

  section.body.appendChild(sectionHeading('Learned procedures', Number(data.verifiedProcedureCount || 0), shownCount(learned.length, Number(data.verifiedProcedureCount || 0))));
  const learnedList = document.createElement('div');
  learnedList.className = 'settings-memory-list';
  if (!learned.length) learnedList.appendChild(emptyText('No learned procedures yet.'));
  else for (const item of learned) learnedList.insertAdjacentHTML('beforeend', procedureRow(item, 'learned'));
  section.body.appendChild(learnedList);

  if (stale.length) {
    section.body.appendChild(sectionHeading('Needs relearning', stale.length));
    const staleList = document.createElement('div');
    staleList.className = 'settings-memory-list';
    for (const item of stale) staleList.insertAdjacentHTML('beforeend', procedureRow(item, 'stale'));
    section.body.appendChild(staleList);
  }
  bindProcedureActions(container, section.body);
  return section;
}

function advancedPanel(container) {
  const section = panel('Advanced');
  const row = document.createElement('div');
  row.className = 'setting-row settings-memory-clear-row';
  row.innerHTML = '<div class="setting-row-copy"><strong>Clear memory & learning</strong><span>Remove all saved memories, observed patterns, learned procedures, and Rel.AI-managed skills created from them.</span></div><button type="button" class="secondary danger" data-clear-memory>Clear…</button>';
  section.body.appendChild(row);

  row.querySelector('[data-clear-memory]').addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Clear memory & learning',
      message: 'Clear all local memory and learned procedures?',
      detail: 'This removes saved memories, learning evidence, and Rel.AI-managed learned skills. Project files and manually created skills are not removed.',
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

function bindProcedureActions(container, root) {
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-dismiss-procedure]');
    if (!button) return;
    const learned = ['learned', 'stale'].includes(button.dataset.procedureState);
    const confirmed = !learned || await confirmAction({
      title: 'Forget learned procedure',
      message: 'Forget this learned procedure?',
      detail: 'Rel.AI will stop suggesting it and remove only the managed skill associated with this learned procedure.',
      confirmLabel: 'Forget procedure',
      danger: true
    });
    if (!confirmed) return;
    button.disabled = true;
    const result = await postJson('/api/knowledge', { action: 'dismiss_procedure', id: button.dataset.dismissProcedure })
      .catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    if (!result?.ok) {
      button.disabled = false;
      setStatus(container, result?.error || 'Could not update learned procedure.');
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

function procedureRow(item, state) {
  const runs = Math.max(0, Number(item.successCount || 0));
  const title = procedureTitle(item.name);
  const description = compactProcedureDescription(item.description);
  const steps = Array.isArray(item.steps) ? item.steps.filter(Boolean) : [];
  const actionLabel = state === 'observed' ? 'Dismiss' : 'Forget';
  const managed = state === 'learned'
    ? '<small>Managed skill updates automatically after later successful runs.</small>'
    : state === 'stale'
      ? '<small>Paused after a failed validation. A later validated matching run can relearn it.</small>'
      : '<small>Not used yet. Rel.AI waits for another independent matching success.</small>';
  const details = steps.length
    ? `<details class="settings-procedure-details"><summary>Details</summary><ol>${steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol></details>`
    : '';
  return `<div class="settings-memory-row settings-procedure-row">
    <div>
      <span class="settings-procedure-title">${esc(title)}</span>
      ${description ? `<small>${esc(description)}</small>` : ''}
      <small>${runs} successful run${runs === 1 ? '' : 's'}</small>
      ${managed}
      ${details}
    </div>
    <button type="button" class="secondary compact-button" data-dismiss-procedure="${esc(item.id)}" data-procedure-state="${state}">${actionLabel}</button>
  </div>`;
}

function procedureTitle(value) {
  const text = String(value || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Learned procedure';
}

function compactProcedureDescription(value) {
  const text = String(value || '').trim();
  const withoutPath = text.split(/\s+Successful path:/i)[0].trim();
  return withoutPath.replace(/^Reusable Rel\.AI procedure for\s+/i, '').replace(/\.$/, '');
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
