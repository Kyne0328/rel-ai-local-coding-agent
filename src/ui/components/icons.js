import { esc } from '../utils.js';

const ICONS = Object.freeze({
  add: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  externalLink: '<path d="M14 5h5v5M19 5l-8 8"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  folder: '<path d="M3.75 6.75A1.75 1.75 0 0 1 5.5 5h4l2 2h7A1.75 1.75 0 0 1 20.25 8.75v8A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
  light: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  dark: '<path d="M20 15.2A8 8 0 0 1 8.8 4 8 8 0 1 0 20 15.2Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.2 9A7 7 0 0 0 6.3 6.3L4 8M5.8 15A7 7 0 0 0 17.7 17.7L20 16"/>',
  system: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M8 20h8M12 16v4"/>',
  warning: '<path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4M12 16h.01"/>'
});

export function iconHtml(name, { className = '' } = {}) {
  const paths = ICONS[name] || ICONS.chevronRight;
  const safeClass = String(className || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  return `<svg class="ui-icon${safeClass ? ` ${safeClass}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
}

export function iconActionHtml(name, label, { position = 'start' } = {}) {
  const icon = iconHtml(name);
  const text = `<span>${esc(label)}</span>`;
  return position === 'end' ? `${text}${icon}` : `${icon}${text}`;
}
