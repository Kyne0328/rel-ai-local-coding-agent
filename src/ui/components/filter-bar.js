function button(label, className, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

export function createFilterBar({
  search = {},
  filters = [],
  onOpenFilters,
  onClearAll,
  summary = '',
  action = null
} = {}) {
  const root = document.createElement('section');
  root.className = 'filter-bar';
  root.setAttribute('aria-label', 'List filters');

  const controls = document.createElement('div');
  controls.className = 'filter-bar-controls';

  const searchWrap = document.createElement('label');
  searchWrap.className = 'filter-search-control';
  const searchLabel = document.createElement('span');
  searchLabel.className = 'sr-only';
  searchLabel.textContent = search.label || 'Search';
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'filter-search-input';
  input.placeholder = search.placeholder || 'Search';
  input.value = String(search.value || '');
  input.autocomplete = 'off';
  input.addEventListener('input', () => search.onInput?.(input.value));
  searchWrap.append(searchLabel, input);
  controls.appendChild(searchWrap);

  const filterCount = filters.length;
  const filterButton = button(
    filterCount ? `Filters (${filterCount})` : 'Filters',
    `secondary filter-open-button${filterCount ? ' active' : ''}`,
    () => onOpenFilters?.()
  );
  filterButton.setAttribute('aria-label', filterCount ? `Open filters; ${filterCount} active` : 'Open filters');
  controls.appendChild(filterButton);

  if (action instanceof Node) {
    const actionWrap = document.createElement('div');
    actionWrap.className = 'filter-bar-action';
    actionWrap.appendChild(action);
    controls.appendChild(actionWrap);
  }
  root.appendChild(controls);

  if (filters.length) {
    const chips = document.createElement('div');
    chips.className = 'filter-chip-list';
    chips.setAttribute('aria-label', 'Active filters');
    for (const filter of filters) {
      const chip = button(`${filter.label}: ${filter.value} ×`, 'secondary filter-chip', () => filter.onRemove?.());
      chip.setAttribute('aria-label', `Remove ${filter.label} filter: ${filter.value}`);
      chips.appendChild(chip);
    }
    root.appendChild(chips);
  }

  const footer = document.createElement('div');
  footer.className = 'filter-bar-footer';
  const summaryElement = document.createElement('span');
  summaryElement.className = 'filter-summary';
  summaryElement.setAttribute('role', 'status');
  summaryElement.setAttribute('aria-live', 'polite');
  summaryElement.textContent = summary;
  footer.appendChild(summaryElement);

  const clearButton = button('Clear all', 'secondary filter-clear-button', () => onClearAll?.());
  clearButton.hidden = !(search.value || filters.length);
  footer.appendChild(clearButton);
  root.appendChild(footer);
  return root;
}
