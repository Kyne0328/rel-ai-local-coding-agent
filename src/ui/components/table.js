// Table — sticky header; virtualizer added in Phase 3
export function Table({ columns, rows, emptyMessage = 'No data.' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';

  const table = document.createElement('table');
  table.className = 'data-table';

  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.setAttribute('scope', 'col');
    th.textContent = col.label;
    if (col.className) th.className = col.className;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (!rows || rows.length === 0) {
    const td = document.createElement('td');
    td.colSpan = columns.length;
    td.innerHTML = `<div class="empty">${emptyMessage}</div>`;
    const emptyRow = document.createElement('tr');
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
  } else {
    for (const row of rows) {
      const rowEl = document.createElement('tr');
      for (const col of columns) {
        const td = document.createElement('td');
        if (col.className) td.className = col.className;
        if (col.render) td.appendChild(col.render(row));
        else td.textContent = row[col.key] != null ? String(row[col.key]) : '';
        rowEl.appendChild(td);
      }
      tbody.appendChild(rowEl);
    }
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// Virtualizer: renders first 50 rows, appends 50 more on IntersectionObserver scroll-end
export function virtualizeTable(tbody, allRows, renderRow) {
  const CHUNK = 50;
  let rendered = 0;
  let sentinel = null;

  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) _renderChunk();
  }, { rootMargin: '200px' });

  function _renderChunk() {
    const chunk = allRows.slice(rendered, rendered + CHUNK);
    for (const row of chunk) {
      const el = renderRow(row);
      if (sentinel) tbody.insertBefore(el, sentinel);
      else tbody.appendChild(el);
    }
    rendered += chunk.length;
    if (rendered >= allRows.length && sentinel) {
      observer.unobserve(sentinel);
      sentinel.remove();
      sentinel = null;
    }
  }

  // Initial render
  tbody.innerHTML = '';
  _renderChunk();
  if (rendered < allRows.length) {
    sentinel = document.createElement('tr');
    sentinel.innerHTML = '<td colspan="99" style="padding:4px;height:1px;"></td>';
    tbody.appendChild(sentinel);
    observer.observe(sentinel);
  }

  return {
    reinit(rows) {
      if (sentinel) { observer.unobserve(sentinel); sentinel = null; }
      allRows = rows;
      rendered = 0;
      tbody.innerHTML = '';
      _renderChunk();
      if (rendered < allRows.length) {
        sentinel = document.createElement('tr');
        sentinel.innerHTML = '<td colspan="99" style="padding:4px;height:1px;"></td>';
        tbody.appendChild(sentinel);
        observer.observe(sentinel);
      }
    },
    getRendered() { return rendered; },
    destroy() {
      if (sentinel) { observer.unobserve(sentinel); sentinel.remove(); sentinel = null; }
      observer.disconnect();
    },
  };
}
