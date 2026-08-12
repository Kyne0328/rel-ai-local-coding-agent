const ICONS = Object.freeze({
  home: '<path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" />',
  tasks: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />',
  workspaces: '<path d="M3 7.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-3H5a2 2 0 0 0-2 2v2.5Z" />',
  skills: '<path d="M5 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H5zM19 4h-5a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h5z" />',
  activity: '<path d="M3 12h4l2.3-6 4.2 12 2.3-6H21" />',
  connection: '<path d="M8.5 15.5 15.5 8.5M7 7h.01M17 17h.01M4 12a8 8 0 1 1 16 0 8 8 0 0 1-16 0Z" />',
  processes: '<rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" />',
  tools: '<path d="m14.7 6.3 3-3a5 5 0 0 1-6.4 6.4l-6.8 6.8a2.1 2.1 0 0 0 3 3l6.8-6.8a5 5 0 0 1 6.4-6.4l-3 3-3-3Z" />',
  diagnostics: '<path d="M12 3v10M12 17v.01M4.9 19h14.2L12 5 4.9 19Z" />',
  usage: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />',
  system: '<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 15h4M15 15h2" />',
  settings: '<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z" />'
});

function route(id, label, path, description, group) {
  return Object.freeze({ id, label, path, href: `#${path}`, description, group, icon: ICONS[id] || '' });
}

export const WORK_NAV_ITEMS = Object.freeze([
  route('home', 'Overview', 'home', 'Connection readiness, workspace state, and recent work sessions.', 'Work'),
  route('tasks', 'Sessions', 'tasks', 'Review active and completed repository work sessions.', 'Work'),
  route('workspaces', 'Workspaces', 'workspaces', 'Manage the repositories Rel.AI may inspect and update.', 'Work'),
  route('activity', 'Tool Activity', 'activity', 'Inspect individual Rel.AI tool calls and recorded output.', 'Work')
]);

export const SYSTEM_NAV_ITEMS = Object.freeze([
  route('connection', 'Connection', 'connection', 'Manage endpoint readiness, authorization, and connection recovery.', 'System'),
  route('processes', 'Processes', 'processes', 'Inspect managed processes and bounded output.', 'System'),
  route('diagnostics', 'Diagnostics', 'diagnostics', 'Review findings, service logs, export, and recovery controls.', 'System'),
  route('tools', 'Tools', 'tools', 'Browse the MCP tools available to ChatGPT.', 'System'),
  route('usage', 'Analytics', 'usage', 'Review privacy-safe Rel.AI activity trends, outcomes, tools, and workspace aggregates stored on this device.', 'System')
]);

export const APPLICATION_NAV_ITEMS = Object.freeze([
  route('system', 'System', 'connection', 'Manage connection, runtime processes, diagnostics, tools, and analytics.', 'Application'),
  route('settings', 'Settings', 'settings', 'Configure preferences, skills, application behavior, and advanced safeguards.', 'Application')
]);

export const DESKTOP_NAV_ITEMS = Object.freeze([...WORK_NAV_ITEMS, ...APPLICATION_NAV_ITEMS]);
export const MOBILE_NAV_ITEMS = Object.freeze([
  WORK_NAV_ITEMS[0],
  WORK_NAV_ITEMS[1],
  WORK_NAV_ITEMS[2],
  APPLICATION_NAV_ITEMS[0],
  APPLICATION_NAV_ITEMS[1]
]);

export const SETTINGS_NAV_ITEMS = Object.freeze([
  route('preferences', 'Preferences', 'settings', 'Control appearance, density, and desktop notifications.', 'Settings'),
  route('skills', 'Skills', 'settings/skills', 'Install reusable skills and choose which workspaces use them.', 'Settings'),
  route('application', 'Application', 'settings/application', 'Manage startup, recovery, and application updates.', 'Settings'),
  route('advanced', 'Advanced', 'settings/advanced', 'Manage patch safeguards and resource limits.', 'Settings'),
  route('about', 'About', 'settings/about', 'View application, developer, repository, and license information.', 'Settings')
]);

const ROUTES = new Map([...DESKTOP_NAV_ITEMS, ...SYSTEM_NAV_ITEMS, ...SETTINGS_NAV_ITEMS].map(item => [item.path, item]));

export function routeMetadata(path) {
  return ROUTES.get(String(path || '').toLowerCase()) || ROUTES.get('home');
}

export function desktopNavigationOwner(sectionId) {
  const id = String(sectionId || '').toLowerCase();
  return SYSTEM_NAV_ITEMS.some(item => item.id === id) ? 'system' : id;
}

export function navigationCommands() {
  return [...WORK_NAV_ITEMS, ...SYSTEM_NAV_ITEMS, ...SETTINGS_NAV_ITEMS];
}
