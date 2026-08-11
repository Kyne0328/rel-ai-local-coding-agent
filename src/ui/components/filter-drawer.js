import { openDrawer, closeDrawer } from './drawer.js';

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function openFilterDrawer({
  title = 'Filters',
  value = {},
  resetValue = {},
  renderFields,
  onApply
} = {}) {
  let draft = clone(value);
  const content = document.createElement('form');
  content.className = 'filter-drawer-form';
  const fields = document.createElement('div');
  fields.className = 'filter-drawer-fields';
  const footer = document.createElement('div');
  footer.className = 'filter-drawer-footer';

  const render = () => {
    fields.replaceChildren();
    renderFields?.(fields, draft);
  };

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'secondary';
  reset.textContent = 'Reset';
  reset.addEventListener('click', () => {
    draft = clone(resetValue);
    render();
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeDrawer);

  const apply = document.createElement('button');
  apply.type = 'submit';
  apply.className = 'primary';
  apply.textContent = 'Apply filters';

  const secondary = document.createElement('div');
  secondary.className = 'filter-drawer-secondary-actions';
  secondary.append(reset, cancel);
  footer.append(secondary, apply);
  content.append(fields, footer);
  content.addEventListener('submit', async event => {
    event.preventDefault();
    apply.disabled = true;
    apply.textContent = 'Applying…';
    try {
      await onApply?.(clone(draft));
      closeDrawer();
    } catch (error) {
      apply.disabled = false;
      apply.textContent = 'Apply filters';
      throw error;
    }
  });

  render();
  const drawer = openDrawer({ title, content, panelClass: 'filter-drawer' });
  queueMicrotask(() => fields.querySelector('input, select, button')?.focus());
  return drawer;
}

export function filterSelectField({ label, value, options, onChange, disabled = false, help = '' }) {
  const field = document.createElement('label');
  field.className = 'filter-field';
  const title = document.createElement('span');
  title.textContent = label;
  const select = document.createElement('select');
  select.disabled = disabled;
  for (const option of options || []) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  }
  select.value = value;
  select.addEventListener('change', () => onChange?.(select.value));
  field.append(title, select);
  if (help) {
    const hint = document.createElement('small');
    hint.textContent = help;
    field.appendChild(hint);
  }
  return field;
}

export function filterRadioField({ label, value, options, onChange }) {
  const group = document.createElement('fieldset');
  group.className = 'filter-field filter-radio-field';
  const legend = document.createElement('legend');
  legend.textContent = label;
  group.appendChild(legend);
  const choices = document.createElement('div');
  choices.className = 'filter-radio-options';
  for (const option of options || []) {
    const choice = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `filter-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    input.value = option.value;
    input.checked = option.value === value;
    input.addEventListener('change', () => {
      if (input.checked) onChange?.(input.value);
    });
    const text = document.createElement('span');
    text.textContent = option.label;
    choice.append(input, text);
    choices.appendChild(choice);
  }
  group.appendChild(choices);
  return group;
}
