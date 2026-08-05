import { fetchJson } from '../../api.js';
import { EmptyState } from '../../components/empty-state.js';
import { esc } from '../../utils.js';

const CAPABILITIES = [
  { id: 'all', label: 'All' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'edit', label: 'Edit' },
  { id: 'validate', label: 'Validate' },
  { id: 'git', label: 'Git' },
  { id: 'recover', label: 'Recover' }
];
const CAPABILITY_ORDER = new Map(CAPABILITIES.slice(1).map((item, index) => [item.id, index]));
const CAPABILITY_IDS = new Set(CAPABILITIES.slice(1).map(item => item.id));

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
          <p>Browse the Rel.AI tools available for inspection, editing, validation, Git publishing, recovery, and workspace administration.</p>
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
  _tools = orderToolsForCatalog(toolsFromPayload(result));
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
      : `${_tools.length} Rel.AI tools`;
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
      : _tools.filter(tool => toolCapabilities(tool).includes(capabilityId)).length;
    button.textContent = `${label} ${total}`;
    button.setAttribute('aria-label', `${label}: ${total} tools`);
  }
}

function matchesFilters(tool) {
  const capabilities = toolCapabilities(tool);
  if (_capability !== 'all' && !capabilities.includes(_capability)) return false;
  if (!_search) return true;
  const searchable = [tool.name, tool.title, tool.displayName, tool.description, ...(tool.parameters || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return searchable.includes(_search);
}

function toolCard(tool) {
  const card = document.createElement('article');
  const capabilities = toolCapabilities(tool);
  const parameters = Array.isArray(tool.parameters) ? tool.parameters : [];
  const compatibility = tool?.state === 'deprecated' || tool?.category === 'Compatibility';
  card.className = `tool-card ${capabilities.map(capability => `capability-${capability}`).join(' ')}${compatibility ? ' compatibility' : ''}`;
  card.innerHTML = `
    <div class="tool-card-head">
      <span class="tool-capability">${esc(compatibility ? 'Compatibility' : capabilities.map(capabilityLabel).join(' · '))}</span>
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

export function orderToolsForCatalog(tools = []) {
  return [...(Array.isArray(tools) ? tools : [])].sort((left, right) => {
    const capabilityDifference = capabilityRank(left) - capabilityRank(right);
    if (capabilityDifference) return capabilityDifference;
    const lifecycleDifference = lifecycleRank(left) - lifecycleRank(right);
    if (lifecycleDifference) return lifecycleDifference;
    return toolSortLabel(left).localeCompare(toolSortLabel(right), 'en-US', { numeric: true, sensitivity: 'base' });
  });
}

function lifecycleRank(tool) {
  return tool?.state === 'deprecated' || tool?.category === 'Compatibility' ? 1 : 0;
}

function capabilityRank(tool) {
  return CAPABILITY_ORDER.get(toolCapability(tool)) ?? CAPABILITY_ORDER.size;
}

function toolSortLabel(tool) {
  return String(tool?.title || tool?.displayName || tool?.name || '');
}

export function toolCapabilities(tool) {
  const explicit = Array.isArray(tool?.capabilities)
    ? tool.capabilities.filter(capability => CAPABILITY_IDS.has(capability))
    : [];
  if (explicit.length) return [...new Set(explicit)];
  return [legacyToolCapability(tool?.name)];
}

function toolCapability(tool) {
  return toolCapabilities(tool)[0] || 'inspect';
}

function legacyToolCapability(name) {
  const value = String(name || '');
  if (value.startsWith('relai_git_')) return 'git';
  if (/restore|reset|tidy/.test(value)) return 'recover';
  if (/run_checks|http_probe|ui_check|browser|diff/.test(value)) return 'validate';
  if (/edit|write|replace/.test(value)) return 'edit';
  return 'inspect';
}

function capabilityLabel(capability) {
  return CAPABILITIES.find(item => item.id === capability)?.label || 'Inspect';
}
