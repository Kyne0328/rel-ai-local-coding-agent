// Table with a sticky header and incremental row rendering.






function makeSentinel(observer) {
  const sentinel = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 1;
  cell.className = 'table-virtual-sentinel-cell';
  sentinel.appendChild(cell);
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
  const targetRendered = Math.min(rows.length, Math.max(state.chunkSize, state.rendered));
  clearSentinel(observer, state);
  state.rows = rows;
  state.rendered = 0;
  tbody.innerHTML = '';
  while (state.rendered < targetRendered) renderChunk(tbody, state, renderRow);
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
