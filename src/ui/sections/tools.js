// Tool Browser — searchable table, category filters, detail drawer
import { fetchJson } from '/ui/api.js';
import { openDrawer } from '/ui/components/drawer.js';

const CATEGORIES = ['Git', 'Docker', 'Workspace', 'Plans', 'Multi-agent', 'CI', 'Audit', 'Release', 'Doctor', 'Memory', 'Approvals', 'Other'];

let _allTools = [];
let _filterState = { search: '', category: '', approvalOnly: false };

export function mountTools(container) {
  _allTools = [];
  _filterState = { search: '', category: '', approvalOnly: false };
  container.innerHTML = '';
  container.appendChild(_buildTools());
  _loadTools();
}

function _buildTools() {
  const root = document.createElement('div');
  root.className = 'section';

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search tools…';
  searchInput.style.cssText = 'width:200px;font-size:13px;';
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { _filterState.search = searchInput.value; _renderTable(_applyFilters(_allTools)); }, 200);
  });

  // Category chips
  const catWrap = document.createElement('div');
  catWrap.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
  const allChip = _chip('All', true, () => {
    _filterState.category = '';
    catWrap.querySelectorAll('button').forEach((b, i) => _styleChip(b, i === 0));
    _renderTable(_applyFilters(_allTools));
  });
  catWrap.appendChild(allChip);
  for (const cat of CATEGORIES) {
    const chip = _chip(cat, false, () => {
      _filterState.category = cat;
      catWrap.querySelectorAll('button').forEach(b => _styleChip(b, b.textContent === cat));
      _renderTable(_applyFilters(_allTools));
    });
    catWrap.appendChild(chip);
  }

  // Approval-only toggle
  const apprLabel = document.createElement('label');
  apprLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text-muted);';
  const apprCheck = document.createElement('input');
  apprCheck.type = 'checkbox';
  apprCheck.addEventListener('change', () => { _filterState.approvalOnly = apprCheck.checked; _renderTable(_applyFilters(_allTools)); });
  apprLabel.appendChild(apprCheck);
  apprLabel.appendChild(document.createTextNode('Requires approval only'));

  toolbar.appendChild(searchInput);
  toolbar.appendChild(catWrap);
  toolbar.appendChild(apprLabel);

  // Table card
  const tableCard = document.createElement('div');
  tableCard.className = 'card';
  tableCard.innerHTML = '<div class="card-head"><h3>Tools</h3><span class="section-action" id="__tools-count">Loading…</span></div><div class="card-body"><div class="table-wrap"><table class="data-table"><caption class="sr-only">MCP tool catalog</caption><thead><tr><th scope="col">Name</th><th scope="col">Category</th><th scope="col">Profile required</th><th scope="col">Approval</th><th scope="col"></th></tr></thead><tbody id="__tools-tbody"></tbody></table></div></div>';

  root.appendChild(toolbar);
  root.appendChild(tableCard);
  return root;
}

async function _loadTools() {
  try {
    const data = await fetchJson('/api/tools');
    _allTools = Array.isArray(data) ? data : [];
    _renderTable(_applyFilters(_allTools));
  } catch (_) {
    const tbody = document.getElementById('__tools-tbody');
    const countEl = document.getElementById('__tools-count');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5"><div class="empty">Failed to load tools.</div></td></tr>';
    if (countEl) countEl.textContent = '—';
  }
}

function _applyFilters(tools) {
  return tools.filter(t => {
    if (_filterState.search) {
      const q = _filterState.search.toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) return false;
    }
    if (_filterState.category && t.category !== _filterState.category) return false;
    if (_filterState.approvalOnly && !t.requiresApproval) return false;
    return true;
  });
}

function _renderTable(tools) {
  const tbody = document.getElementById('__tools-tbody');
  const countEl = document.getElementById('__tools-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = tools.length + ' tools';

  tbody.innerHTML = tools.map(t => `<tr style="cursor:pointer;" data-name="${esc(t.name)}">
    <td class="mono" style="font-size:12px;">${esc(t.name)}</td>
    <td><span class="badge">${esc(t.category)}</span></td>
    <td><span class="badge ${t.requiredProfile === 'admin' ? 'warn' : ''}">${esc(t.requiredProfile)}</span></td>
    <td>${t.requiresApproval ? '<span class="badge warn">requires approval</span>' : '<span style="color:var(--text-dim);">—</span>'}</td>
    <td><button class="secondary" style="min-height:24px;padding:0 8px;font-size:11px;">▸</button></td>
  </tr>`).join('') || `<tr><td colspan="5"><div class="empty">No tools match your filters.</div></td></tr>`;

  tbody.querySelectorAll('tr[data-name]').forEach(row => {
    const name = row.dataset.name;
    const tool = tools.find(t => t.name === name);
    if (tool) row.onclick = () => _openDetail(tool);
  });
}

function _openDetail(tool) {
  const content = document.createElement('div');
  content.style.cssText = 'display:grid;gap:14px;font-size:13px;';

  const meta = document.createElement('div');
  meta.style.cssText = 'display:grid;gap:8px;';
  meta.innerHTML = [
    ['Category', tool.category],
    ['Profile required', tool.requiredProfile],
    ['Requires approval', tool.requiresApproval ? 'Yes' : 'No'],
  ].map(([k, v]) => `<div style="display:flex;gap:10px;"><span style="color:var(--text-muted);min-width:130px;">${esc(k)}</span><span>${esc(String(v))}</span></div>`).join('');

  if (tool.description) {
    const desc = document.createElement('p');
    desc.style.cssText = 'color:var(--text-muted);margin:0;';
    desc.textContent = tool.description;
    content.appendChild(desc);
  }
  content.appendChild(meta);

  if (tool.parameters && tool.parameters.length) {
    const params = document.createElement('div');
    params.innerHTML = '<div style="font-weight:700;margin-bottom:8px;">Parameters</div>';
    for (const p of tool.parameters) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:6px 10px;background:var(--bg);border:1px solid var(--line-soft);border-radius:6px;font-size:12px;font-family:monospace;margin-bottom:4px;';
      row.textContent = p;
      params.appendChild(row);
    }
    content.appendChild(params);
  }

  const template = `Run ${tool.name} with workspace="<alias>"`;
  const copyWrap = document.createElement('div');
  copyWrap.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-top:4px;';
  const pre = document.createElement('pre');
  pre.style.cssText = 'flex:1;font-size:11px;background:var(--bg);border:1px solid var(--line-soft);border-radius:6px;padding:8px;overflow:auto;white-space:pre-wrap;margin:0;';
  pre.textContent = template;
  const copyBtn = document.createElement('button');
  copyBtn.className = 'secondary';
  copyBtn.style.cssText = 'min-height:28px;padding:0 10px;font-size:12px;flex-shrink:0;';
  copyBtn.textContent = 'Copy';
  copyBtn.onclick = async () => { await navigator.clipboard.writeText(template); copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000); };
  copyWrap.appendChild(pre);
  copyWrap.appendChild(copyBtn);
  content.appendChild(copyWrap);

  openDrawer({ title: tool.name, content });
}

function _chip(label, active, onClick) {
  const btn = document.createElement('button');
  btn.className = 'secondary';
  btn.style.cssText = 'min-height:26px;padding:0 10px;font-size:12px;border-radius:999px;';
  btn.textContent = label;
  _styleChip(btn, active);
  btn.onclick = onClick;
  return btn;
}

function _styleChip(btn, active) {
  btn.style.background = active ? 'var(--blue-dim)' : '';
  btn.style.borderColor = active ? 'var(--ring)' : '';
}

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
