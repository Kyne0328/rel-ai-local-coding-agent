import { fetchJson, postJson } from '../../api.js';
import { esc } from '../../utils.js';
import { panel, toggleControl, toggleRow } from './shared.js';

export async function knowledgePanel() {
  const card = panel('Memory & learning');
  card.body.innerHTML = '<div class="settings-loading">Loading memory…</div>';
  await render(card.body);
  return card.el;
}

async function render(body) {
  body._knowledgeAbortController?.abort();
  body._knowledgeAbortController = new AbortController();
  try {
    const data = await fetchJson('/api/knowledge', { cache: 'no-store' });
    if (!data.ok) {
      body.innerHTML = `<p class="settings-help">${esc(data.error || 'Memory is unavailable.')}</p>`;
      return;
    }
    body.innerHTML = '';
    body.appendChild(memoryToggleRow(body, data));
    body.appendChild(learningToggleRow(body, data));

    const content = document.createElement('div');
    content.className = 'settings-memory-content';
    const candidates = (data.procedures || []).filter(item => item.status === 'candidate').slice(0, 4);
    const verified = (data.procedures || []).filter(item => item.status === 'verified').slice(0, 4);
    content.innerHTML = `
      <p class="settings-help">Rel.AI stores this knowledge only on this computer. It can correlate Rel.AI work from the same ChatGPT conversation, but it does not receive the full ChatGPT transcript.</p>
      <div class="settings-inline-summary" aria-label="Memory summary">
        <span>${Number(data.knowledgeCount || 0)} saved memories</span>
        <span>${Number(data.candidateCount || 0)} candidates</span>
        <span>${Number(data.verifiedProcedureCount || 0)} verified procedures</span>
      </div>
      <form class="settings-inline-form" method="post" data-memory-form>
        <input type="text" name="content" maxlength="4000" placeholder="Add a reusable fact or preference" aria-label="Reusable memory" required>
        <label class="sr-only" for="knowledge-memory-scope">Memory scope</label>
        <select id="knowledge-memory-scope" name="scope"><option value="global">All projects</option><option value="workspace">One project</option></select>
        <input type="text" name="workspace" maxlength="120" placeholder="Project alias" aria-label="Project alias" hidden>
        <button type="submit" class="secondary compact-button">Add</button>
      </form>
      ${sectionList('Review learned procedures', candidates, true)}
      ${sectionList('Verified procedures', verified, false)}
      <details class="settings-disclosure"><summary>Stored knowledge</summary><div class="settings-memory-list">${(data.items || []).slice(0, 12).map(memoryRow).join('') || '<p class="settings-help">No saved knowledge yet.</p>'}</div></details>
      <button type="button" class="danger secondary compact-button" data-clear-memory>Clear local memory & learning</button>
      <p class="settings-help" role="status" aria-live="polite" data-memory-status></p>`;
    body.appendChild(content);
    bindContent(body, content);
  } catch (error) {
    body.innerHTML = `<p class="settings-help">${esc(error instanceof Error ? error.message : 'Memory is unavailable.')}</p>`;
  }
}

function memoryToggleRow(body, data) {
  return toggleRow(
    'Long-term knowledge',
    toggleControl(data.settings?.enabled !== false, value => { void updateSettings(body, { enabled: value }); }),
    'Use local global and project-specific knowledge when new Rel.AI work starts.'
  );
}

function learningToggleRow(body, data) {
  return toggleRow(
    'Procedural learning',
    toggleControl(data.settings?.proceduralLearning !== false, value => { void updateSettings(body, { proceduralLearning: value }); }),
    'Create reusable candidates only from explicitly completed work with authoritative evidence.'
  );
}

async function updateSettings(body, patch) {
  const status = body.querySelector('[data-memory-status]');
  try {
    const result = await postJson('/api/knowledge', { action: 'settings', ...patch });
    if (status) status.textContent = result.ok ? 'Saved locally.' : (result.error || 'Could not save memory settings.');
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'Could not save memory settings.';
  }
}

function sectionList(title, items, candidate) {
  if (!items.length) return '';
  return `<div class="settings-memory-section"><strong>${esc(title)}</strong>${items.map(item => procedureRow(item, candidate)).join('')}</div>`;
}

function procedureRow(item, candidate) {
  const actions = candidate
    ? `<button type="button" class="secondary compact-button" data-trust-procedure="${esc(item.id)}">Trust</button><button type="button" class="secondary compact-button" data-reject-procedure="${esc(item.id)}">Reject</button>`
    : `<button type="button" class="secondary compact-button" data-promote-skill="${esc(item.id)}">Create skill</button>`;
  return `<div class="settings-memory-row"><div><span>${esc(item.name)}</span><small>${esc(item.description)}</small><small>${Number(item.successCount || 0)} successful run${Number(item.successCount || 0) === 1 ? '' : 's'}</small></div><div class="button-row">${actions}</div></div>`;
}

function memoryRow(item) {
  return `<div class="settings-memory-row"><div><span>${esc(item.content)}</span><small>${esc(item.scope === 'workspace' ? `Project: ${item.workspace}` : 'All projects')}</small></div><button type="button" class="secondary compact-button" data-delete-memory="${esc(item.id)}">Remove</button></div>`;
}

function bindContent(body, content) {
  const form = content.querySelector('[data-memory-form]');
  const scope = form?.elements?.scope;
  const workspace = form?.elements?.workspace;
  const signal = body._knowledgeAbortController?.signal;
  scope?.addEventListener('change', () => {
    const workspaceScoped = scope.value === 'workspace';
    workspace.hidden = !workspaceScoped;
    workspace.required = workspaceScoped;
    if (!workspaceScoped) workspace.value = '';
  }, { signal });
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const status = body.querySelector('[data-memory-status]');
    try {
      const result = await postJson('/api/knowledge', {
        action: 'add',
        content: String(form.elements.content.value || '').trim(),
        scope: scope.value,
        workspace: workspace.value
      });
      if (!result.ok) {
        if (status) status.textContent = result.error || 'Could not save memory.';
        return;
      }
      await render(body);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : 'Could not save memory.';
    }
  }, { signal });

  content.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || button.type === 'submit') return;
    let payload = null;
    if (button.dataset.deleteMemory) payload = { action: 'delete', id: button.dataset.deleteMemory };
    else if (button.dataset.trustProcedure) payload = { action: 'trust_procedure', id: button.dataset.trustProcedure };
    else if (button.dataset.rejectProcedure) payload = { action: 'reject_procedure', id: button.dataset.rejectProcedure };
    else if (button.dataset.promoteSkill) payload = { action: 'promote_skill', id: button.dataset.promoteSkill };
    else if (button.hasAttribute('data-clear-memory')) {
      if (!window.confirm('Clear all local Rel.AI knowledge and learned procedures?')) return;
      payload = { action: 'clear', confirm: true };
    }
    if (!payload) return;
    const status = body.querySelector('[data-memory-status]');
    button.disabled = true;
    try {
      const result = await postJson('/api/knowledge', payload);
      if (!result.ok) {
        button.disabled = false;
        if (status) status.textContent = result.error || 'Memory action failed.';
        return;
      }
      await render(body);
    } catch (error) {
      button.disabled = false;
      if (status) status.textContent = error instanceof Error ? error.message : 'Memory action failed.';
    }
  }, { signal });
}
