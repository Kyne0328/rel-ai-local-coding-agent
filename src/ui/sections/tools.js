import { fetchJson } from '../api.js';
import { EmptyState } from '../components/empty-state.js';
import { esc } from '../utils.js';

const CAPABILITIES = [
  { id: 'all', label: 'All' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'edit', label: 'Edit' },
  { id: 'validate', label: 'Validate' },
  { id: 'git', label: 'Git' },
  { id: 'recover', label: 'Recover' }
];

let _mounted = 0;
let _tools = [];
let _search = '';
let _capability = 'all';

export function mountTools(container) {
  const mountId = ++_mounted;
  _search = '';
  _capability = 'all';
  container.innerHTML = `
    <div class="section tools-section">
      <div class="section-head">
        <div>
          <h2>Tools</h2>
          <p>Only tools exposed by the active connector are shown. Some require a Git repository, remote, route or check, bundle path, or tidy plan.</p>
        </div>
        <span class="section-action" id="toolsCount">Loading…</span>
      </div>
      <div class="tools-toolbar">
        <input class="tools-search" id="toolsSearch" type="search" placeholder="Search tools" aria-label="Search tools">
        <div class="tools-filters" id="toolsFilters" role="group" aria-label="Filter tools by capability"></div>
      </div>
      <div id="toolsBody" class="tools-grid"><div class="empty">Loading tools…</div></div>
    </div>`;
  bindToolbar(container);
  loadTools(container, mountId);
}

function bindToolbar(container) {
  const search = container.querySelector('#toolsSearch');
  const filters = container.querySelector('#toolsFilters');
  for (const capability of CAPABILITIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `secondary tools-filter${capability.id === _capability ? ' active' : ''}`;
    button.textContent = capability.label;
    button.dataset.capability = capability.id;
    button.setAttribute('aria-pressed', String(capability.id === _capability));
    button.onclick = () => {
      _capability = capability.id;
      filters.querySelectorAll('button').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      renderTools(container);
    };
    filters.appendChild(button);
  }
  search.addEventListener('input', () => {
    _search = search.value.trim().toLowerCase();
    renderTools(container);
  });
}

async function loadTools(container, mountId) {
  const result = await fetchJson('/api/tools');
  if (mountId !== _mounted) return;
  _tools = toolsFromPayload(result);
  renderTools(container);
}

function renderTools(container) {
  const body = container.querySelector('#toolsBody');
  const count = container.querySelector('#toolsCount');
  if (!body) return;
  const visible = _tools.filter(matchesFilters);
  const filtered = _capability !== 'all' || Boolean(_search);
  if (count) {
    count.textContent = filtered
      ? `Showing ${visible.length} of ${_tools.length} tools`
      : `${_tools.length} public tools`;
  }
  updateFilterCounts(container);
  body.innerHTML = '';
  if (!visible.length) {
    body.appendChild(EmptyState({ title: 'No matching tools', description: 'Change the search or capability filter.' }));
    return;
  }
  for (const tool of visible) body.appendChild(toolCard(tool));
}

function updateFilterCounts(container) {
  const filters = container.querySelector('#toolsFilters');
  if (!filters) return;
  for (const button of filters.querySelectorAll('button[data-capability]')) {
    const capabilityId = button.dataset.capability || 'all';
    const definition = CAPABILITIES.find(item => item.id === capabilityId);
    const label = definition?.label || capabilityId;
    const total = capabilityId === 'all'
      ? _tools.length
      : _tools.filter(tool => toolCapability(tool.name) === capabilityId).length;
    button.textContent = `${label} ${total}`;
    button.setAttribute('aria-label', `${label}: ${total} tools`);
  }
}

function matchesFilters(tool) {
  const capability = toolCapability(tool.name);
  if (_capability !== 'all' && capability !== _capability) return false;
  if (!_search) return true;
  const searchable = [tool.name, tool.title, tool.displayName, tool.description, ...(tool.parameters || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return searchable.includes(_search);
}

function toolCard(tool) {
  const card = document.createElement('article');
  const capability = toolCapability(tool.name);
  const parameters = Array.isArray(tool.parameters) ? tool.parameters : [];
  card.className = `tool-card capability-${capability}`;
  card.innerHTML = `
    <div class="tool-card-head">
      <span class="tool-capability">${esc(capabilityLabel(capability))}</span>
      <span class="tool-parameter-count">${parameters.length} parameter${parameters.length === 1 ? '' : 's'}</span>
    </div>
    <div class="tool-card-title">
      <h3>${esc(tool.title || tool.displayName || tool.name || 'Tool')}</h3>
      <code>${esc(tool.name || '')}</code>
    </div>
    <p>${esc(tool.description || 'No description provided.')}</p>
    ${parameterMarkup(parameters)}`;
  return card;
}

function parameterMarkup(parameters) {
  if (!parameters.length) return '<div class="tool-parameters-empty">No input parameters</div>';
  return `
    <details class="tool-parameters">
      <summary>View parameters</summary>
      <div class="tool-parameter-list">${parameters.map(parameter => `<code>${esc(parameter)}</code>`).join('')}</div>
    </details>`;
}

function toolsFromPayload(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.tools) ? result.tools : [];
}

function toolCapability(name) {
  const value = String(name || '');
  if (value.startsWith('relai_git_')) return 'git';
  if (/restore|tidy/.test(value)) return 'recover';
  if (/run_checks|browser|diff/.test(value)) return 'validate';
  if (/edit|write|replace|apply_bundle/.test(value)) return 'edit';
  return 'inspect';
}

function capabilityLabel(capability) {
  return CAPABILITIES.find(item => item.id === capability)?.label || 'Inspect';
}
