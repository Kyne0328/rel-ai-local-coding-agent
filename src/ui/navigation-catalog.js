const ICONS = Object.freeze({
  home: '<path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" />',
  tasks: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />',
  code: '<path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14" />',
  workspaces: '<path d="M3 7.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-3H5a2 2 0 0 0-2 2v2.5Z" />',
  activity: '<path d="M3 12h4l2.3-6 4.2 12 2.3-6H21" />',
  preferences: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6" />',
  memory: '<path d="M8 4a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4H8Z"/><path d="M8 9h8M8 13h6M8 17h4"/>',
  application: '<rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" />',
  about: '<circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" />',
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
  route('home', 'Overview', 'home', 'Connection status, projects, and recent tasks.', 'Work'),
  route('tasks', 'Tasks', 'tasks', 'See active and completed Rel.AI tasks.', 'Work'),
  route('code', 'Changes', 'code', 'Review current and committed file changes for a Rel.AI task.', 'Work'),
  route('workspaces', 'Projects', 'workspaces', 'Choose which project folders Rel.AI can use.', 'Work'),
  route('activity', 'Activity', 'activity', 'See Rel.AI actions and their results.', 'Work')
]);

export const SYSTEM_NAV_ITEMS = Object.freeze([
  route('processes', 'Running commands', 'processes', 'See and stop long-running commands started by Rel.AI.', 'System'),
  route('diagnostics', 'Troubleshooting', 'diagnostics', 'Find and fix problems, view logs, or export support information.', 'System'),
  route('tools', 'ChatGPT tools', 'tools', 'See the actions ChatGPT can ask Rel.AI to perform.', 'System'),
  route('usage', 'Analytics', 'usage', 'See activity trends, reliability, and problem areas.', 'System')
]);

export const APPLICATION_NAV_ITEMS = Object.freeze([
  route('system', 'System', 'processes', 'Running commands, troubleshooting, tools, and analytics.', 'Application'),
  route('settings', 'Settings', 'settings', 'Change connection, preferences, memory, and app settings.', 'Application')
]);

export const DESKTOP_NAV_ITEMS = Object.freeze([...WORK_NAV_ITEMS, ...APPLICATION_NAV_ITEMS]);
export const MOBILE_NAV_ITEMS = Object.freeze([...DESKTOP_NAV_ITEMS]);

export const SETTINGS_NAV_ITEMS = Object.freeze([
  route('connection', 'Connection', 'settings/connection', 'Connect this computer and change OpenAI connection settings.', 'Settings'),
  route('preferences', 'Preferences', 'settings', 'Change appearance and desktop notifications.', 'Settings'),
  route('memory', 'Memory & learning', 'settings/memory', 'Manage local memories and reusable workflows learned from completed work.', 'Settings'),
  route('application', 'App', 'settings/application', 'Choose startup behavior and manage app updates.', 'Settings'),
  route('about', 'About', 'settings/about', 'View app, developer, source code, and license information.', 'Settings')
]);

const ROUTES = new Map([...DESKTOP_NAV_ITEMS, ...SYSTEM_NAV_ITEMS, ...SETTINGS_NAV_ITEMS].map(item => [item.path, item]));

export function routeMetadata(path) {
  return ROUTES.get(String(path || '').toLowerCase()) || ROUTES.get('home');
}

export function desktopNavigationOwner(sectionId) {
  const id = String(sectionId || '').toLowerCase();
  if (SYSTEM_NAV_ITEMS.some(item => item.id === id)) return 'system';
  if (SETTINGS_NAV_ITEMS.some(item => item.id === id)) return 'settings';
  return id;
}

export function navigationCommands() {
  return [...WORK_NAV_ITEMS, ...SYSTEM_NAV_ITEMS, ...SETTINGS_NAV_ITEMS];
}
