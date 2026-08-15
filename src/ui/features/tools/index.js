import { fetchJson } from '../../api.js';
import { EmptyState } from '../../components/empty-state.js';
import { createFilterBar } from '../../components/filter-bar.js';
import { filterRadioField, openFilterDrawer } from '../../components/filter-drawer.js';
import { esc } from '../../utils.js';

const CAPABILITIES = [
  { id: 'all', label: 'All capabilities' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'edit', label: 'Edit' },
  { id: 'execute', label: 'Execute' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'review', label: 'Review' },
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
let _loadError = '';

export function mountTools(container) {
  const mountId = ++_mounted;
  _search = '';
  _capability = 'all';
  _loadError = '';
  container.innerHTML = `
    <div class="section tools-section">
      <div class="section-head">
        <div>
          <h2>ChatGPT tools</h2>
          <p>See the actions ChatGPT can ask Rel.AI to use for reading files, making changes, running checks, using Git, and fixing problems.</p>
        </div>
        <span class="section-action" id="toolsCount">Loading…</span>
      </div>
      <div id="toolsToolbar"></div>
      <div id="toolsBody" class="tools-grid"><div class="empty">Loading tools…</div></div>
    </div>`;
  renderToolbar(container);
  void loadTools(container, mountId);
}

function renderToolbar(container) {
  const host = container.querySelector('#toolsToolbar');
  if (!host) return;
  const filters = activeToolFilters();
  const visible = _tools.filter(matchesFilters);
  host.replaceChildren(createFilterBar({
    search: {
      label: 'Search tools',
      placeholder: 'Search tools',
      value: _search,
      onInput: value => {
        _search = value.trim().toLowerCase();
        renderTools(container, { preserveToolbar: true });
      }
    },
    filters,
    onOpenFilters: () => openCapabilityFilters(container),
    onClearAll: () => {
      _search = '';
      _capability = 'all';
      renderTools(container);
    },
    summary: _loadError ? 'Tool catalog unavailable' : _tools.length ? `${visible.length} of ${_tools.length} tools shown` : 'Loading tool catalog…'
  }));
}

function activeToolFilters() {
  if (_capability === 'all') return [];
  return [{
    label: 'Capability',
    value: capabilityLabel(_capability),
    onRemove: () => {
      _capability = 'all';
      const container = document.querySelector('.tools-section')?.parentElement;
      if (container) renderTools(container);
    }
  }];
}

function openCapabilityFilters(container) {
  openFilterDrawer({
    title: 'Tool filters',
    value: { capability: _capability },
    resetValue: { capability: 'all' },
    renderFields(fields, draft) {
      const options = CAPABILITIES.map(capability => ({
        value: capability.id,
        label: `${capability.label} (${capabilityCount(capability.id)})`
      }));
      fields.appendChild(filterRadioField({
        label: 'Capability',
        value: draft.capability,
        options,
        onChange: value => { draft.capability = value; }
      }));
    },
    onApply(draft) {
      _capability = CAPABILITY_IDS.has(draft.capability) ? draft.capability : 'all';
      renderTools(container);
    }
  });
}

function capabilityCount(capability) {
  if (capability === 'all') return _tools.length;
  return _tools.filter(tool => toolCapabilities(tool).includes(capability)).length;
}

async function loadTools(container, mountId) {
  const result = await fetchJson('/api/tools', { cache: 'no-store' });
  if (mountId !== _mounted) return;
  const tools = toolsFromPayload(result);
  if (result?.ok === false || tools == null) {
    _tools = [];
    _loadError = String(result?.error || 'The tool catalog returned an unexpected response.');
  } else {
    _tools = orderToolsForCatalog(tools);
    _loadError = '';
  }
  renderTools(container);
}

function renderTools(container, { preserveToolbar = false } = {}) {
  const body = container.querySelector('#toolsBody');
  const count = container.querySelector('#toolsCount');
  if (!body) return;
  const visible = _tools.filter(matchesFilters);
  const filtered = _capability !== 'all' || Boolean(_search);
  if (count) count.textContent = _loadError ? 'Unavailable' : filtered ? `Showing ${visible.length} of ${_tools.length}` : `${_tools.length} Rel.AI tools`;
  if (!preserveToolbar) renderToolbar(container);
  else {
    const summary = container.querySelector('#toolsToolbar .filter-summary');
    if (summary) summary.textContent = `${visible.length} of ${_tools.length} tools shown`;
  }
  body.innerHTML = '';
  if (_loadError) {
    body.appendChild(EmptyState({
      icon: '!',
      title: 'Tool catalog unavailable',
      description: _loadError,
      cta: 'Retry',
      onCta: () => void loadTools(container, _mounted)
    }));
    return;
  }
  if (!visible.length) {
    body.appendChild(EmptyState({
      title: _tools.length ? 'No matching tools' : 'No tools available',
      description: _tools.length ? 'Change the search or capability filter.' : 'Rel.AI did not report any ChatGPT tools.'
    }));
    return;
  }
  for (const tool of visible) body.appendChild(toolCard(tool));
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
  if (Array.isArray(result?.tools)) return result.tools;
  return null;
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
  if (value === 'relai_work') return 'workflow';
  if (value === 'relai_exec' || value === 'relai_process') return 'execute';
  if (value === 'relai_changes') return 'review';
  if (value.startsWith('relai_git_') || value === 'relai_publish') return 'git';
  if (/restore|reset|tidy/.test(value)) return 'recover';
  if (/run_checks|http_probe|ui_check|browser/.test(value) || value === 'relai_validate') return 'validate';
  if (/edit|write|replace/.test(value)) return 'edit';
  return 'inspect';
}

function capabilityLabel(capability) {
  return CAPABILITIES.find(item => item.id === capability)?.label || 'Inspect';
}
