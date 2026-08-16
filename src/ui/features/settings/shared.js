import { Toggle } from '../../components/toggle.js';
import { esc } from '../../utils.js';

let fieldId = 0;

export function header(title, body) {
  const wrapper = document.createElement('div');
  wrapper.className = 'settings-header';
  const description = body ? `<p>${esc(body)}</p>` : '';
  wrapper.innerHTML = `<h2>${esc(title)}</h2>${description}`;
  return wrapper;
}

export function panel(title, body) {
  const element = document.createElement('div');
  element.className = 'card';
  element.innerHTML = `<div class="card-head"><h3>${esc(title)}</h3></div>`;
  const content = document.createElement('div');
  content.className = 'card-body settings-panel-body';
  if (body) content.appendChild(body);
  element.appendChild(content);
  return { el: element, body: content };
}


export function field(label, control, help) {
  const wrapper = document.createElement('div');
  wrapper.className = 'settings-field';
  const labelElement = document.createElement('label');
  labelElement.textContent = label;
  const labelTarget = labelableControl(control);
  if (labelTarget) {
    if (!labelTarget.id) labelTarget.id = `settingsField${++fieldId}`;
    labelElement.htmlFor = labelTarget.id;
  }
  wrapper.append(labelElement, control);
  if (help) {
    const paragraph = document.createElement('p');
    paragraph.className = 'settings-help';
    paragraph.textContent = help;
    wrapper.appendChild(paragraph);
  }
  return wrapper;
}

function labelableControl(control) {
  if (!control) return null;
  if (control.matches?.('input, select, textarea')) return control;
  return control.querySelector?.('input, select, textarea') || null;
}

export function toggleControl(checked, onChange, { enabled = 'Enabled', disabled = 'Disabled' } = {}) {
  let control;
  control = Toggle({
    checked: Boolean(checked),
    label: checked ? enabled : disabled,
    onChange: value => {
      onChange(value);
      const label = control.querySelector('.toggle-label');
      if (label) label.textContent = value ? enabled : disabled;
    }
  });
  return control;
}

export function toggleRow(label, control, help = '') {
  const wrapper = document.createElement('div');
  wrapper.className = 'setting-row settings-toggle-row';
  const copy = document.createElement('div');
  copy.className = 'setting-row-copy';
  const heading = document.createElement('strong');
  const id = `settingsToggle${++fieldId}`;
  heading.id = id;
  heading.textContent = label;
  copy.appendChild(heading);
  let description = null;
  if (help) {
    description = document.createElement('span');
    description.id = `${id}Help`;
    description.textContent = help;
    copy.appendChild(description);
  }
  const input = labelableControl(control);
  if (input) {
    input.setAttribute('aria-labelledby', id);
    if (description) input.setAttribute('aria-describedby', description.id);
  }
  control.classList.add('settings-toggle-control');
  wrapper.append(copy, control);
  return wrapper;
}

export function numberControl(value, onChange, { min = 0, max = 1000000, step = 1 } = {}) {
  const element = document.createElement('input');
  element.className = 'settings-number-control';
  element.type = 'number';
  element.value = value == null ? '' : value;
  element.min = String(min);
  element.max = String(max);
  element.step = String(step);
  element.addEventListener('input', () => onChange(Number(element.value)));
  return element;
}



