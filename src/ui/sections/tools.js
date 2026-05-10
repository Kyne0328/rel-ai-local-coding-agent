// Tools section - visible ChatGPT local repo bridge tools only
import { fetchJson } from '/ui/api.js';
import { badgeHtml } from '/ui/components/badge.js';
import { EmptyState } from '/ui/components/empty-state.js';
import { esc } from '/ui/utils.js';

let _mounted = 0;

export function mountTools(container) {
  const mountId = ++_mounted;
  container.innerHTML = `
    <div class="section">
      <div class="section-head">
        <div>
          <h2>Tools</h2>
          <p>The public ChatGPT bridge tools. Legacy compatibility tools are hidden from this list.</p>
        </div>
        <span class="section-action">loading</span>
      </div>
      <div id="toolsBody" class="card"><div class="empty">Loading tools...</div></div>
    </div>`;
  loadTools(container, mountId);
}

async function loadTools(container, mountId) {
  const result = await fetchJson('/api/tools');
  if (mountId !== _mounted) return;
  const body = container.querySelector('#toolsBody');
  const count = container.querySelector('.section-action');
  const tools = Array.isArray(result) ? result : Array.isArray(result?.tools) ? result.tools : [];
  if (count) count.textContent = tools.length + ' available';
  if (!body) return;
  if (!tools.length) {
    body.innerHTML = '';
    body.appendChild(EmptyState({ title: 'No tools returned', description: 'Check the connector token and server status.' }));
    return;
  }
  body.innerHTML = `
    <div class="table-wrap">
      <table class="data-table tools-table">
        <thead><tr><th class="tool-name-col">Name</th><th>Description</th><th class="tool-params-col">Parameters</th></tr></thead>
        <tbody>${tools.map(toolRow).join('')}</tbody>
      </table>
    </div>
    <div class="path" style="padding:12px 14px;border-top:1px solid var(--line);">
      Normal ChatGPT mode intentionally exposes only this single bridge workflow. Legacy shell, patch, and task-runner tools are debug-mode only.
    </div>`;
}

function toolRow(tool) {
  const params = Array.isArray(tool.parameters) && tool.parameters.length
    ? tool.parameters.map((p) => badgeHtml(p)).join('')
    : '<span class="path">none</span>';
  return `
    <tr>
      <td class="mono tool-name">${esc(tool.name || '')}</td>
      <td class="tool-description">${esc(tool.description || '')}</td>
      <td><div class="tool-params">${params}</div></td>
    </tr>`;
}
