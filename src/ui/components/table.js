// Table with a sticky header and incremental row rendering.
function renderHeader(columns) {
  const thead = document.createElement('thead');
  const row = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.setAttribute('scope', 'col');
    th.textContent = col.label;
    if (col.className) th.className = col.className;
    row.appendChild(th);
  }
  thead.appendChild(row);
  return thead;
}

function renderEmptyRow(columns, emptyMessage) {
  const td = document.createElement('td');
  td.colSpan = columns.length;
  td.innerHTML = `<div class="empty">${emptyMessage}</div>`;
  const row = document.createElement('tr');
  row.appendChild(td);
  return row;
}

function renderCell(row, col) {
  const td = document.createElement('td');
  if (col.className) td.className = col.className;
  if (col.render) td.appendChild(col.render(row));
  else td.textContent = row[col.key] != null ? String(row[col.key]) : '';
  return td;
}

function renderDataRow(row, columns) {
  const rowEl = document.createElement('tr');
  for (const col of columns) rowEl.appendChild(renderCell(row, col));
  return rowEl;
}

function renderBody(columns, rows, emptyMessage) {
  const tbody = document.createElement('tbody');
  if (!rows || rows.length === 0) {
    tbody.appendChild(renderEmptyRow(columns, emptyMessage));
    return tbody;
  }
  for (const row of rows) tbody.appendChild(renderDataRow(row, columns));
  return tbody;
}

export function Table({ columns, rows, emptyMessage = 'No data.' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';

  const table = document.createElement('table');
  table.className = 'data-table';
  table.appendChild(renderHeader(columns));
  table.appendChild(renderBody(columns, rows, emptyMessage));
  wrap.appendChild(table);
  return wrap;
}

function makeSentinel(observer) {
  const sentinel = document.createElement('tr');
  sentinel.innerHTML = '<td colspan="99" style="padding:4px;height:1px;"></td>';
  observer.observe(sentinel);
  return sentinel;
}

function clearSentinel(observer, state) {
  if (!state.sentinel) return;
  observer.unobserve(state.sentinel);
  state.sentinel.remove();
  state.sentinel = null;
}

function appendVirtualRow(tbody, state, renderRow, row) {
  const el = renderRow(row);
  if (state.sentinel) state.sentinel.before(el);
  else tbody.appendChild(el);
}

function renderChunk(tbody, state, renderRow) {
  const chunk = state.rows.slice(state.rendered, state.rendered + state.chunkSize);
  for (const row of chunk) appendVirtualRow(tbody, state, renderRow, row);
  state.rendered += chunk.length;
}

function attachSentinel(tbody, observer, state) {
  if (state.rendered >= state.rows.length) return;
  state.sentinel = makeSentinel(observer);
  tbody.appendChild(state.sentinel);
}

function resetVirtualRows(tbody, observer, state, renderRow, rows) {
  clearSentinel(observer, state);
  state.rows = rows;
  state.rendered = 0;
  tbody.innerHTML = '';
  renderChunk(tbody, state, renderRow);
  attachSentinel(tbody, observer, state);
}

// Virtualizer: renders first 50 rows, appends 50 more on IntersectionObserver scroll-end
export function virtualizeTable(tbody, allRows, renderRow) {
  const state = { chunkSize: 50, rendered: 0, sentinel: null, rows: allRows };
  const observer = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    renderChunk(tbody, state, renderRow);
    if (state.rendered >= state.rows.length) clearSentinel(observer, state);
  }, { rootMargin: '200px' });

  resetVirtualRows(tbody, observer, state, renderRow, allRows);

  return {
    reinit(rows) { resetVirtualRows(tbody, observer, state, renderRow, rows); },
    getRendered() { return state.rendered; },
    destroy() {
      clearSentinel(observer, state);
      observer.disconnect();
    },
  };
}
