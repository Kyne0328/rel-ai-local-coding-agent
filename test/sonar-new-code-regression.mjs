import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const dashboardWindow = read('electron/dashboard-window.js');
const status = read('electron/renderer/status.js');
const sleepBlocker = read('electron/tool-sleep-blocker.js');
const dashboard = read('public/dashboard.js');
const home = read('src/ui/sections/home.js');
const workspaceState = read('src/workspaceState.js');

assert.doesNotMatch(dashboardWindow, /\bvoid\s+shell\.openExternal/);
assert.doesNotMatch(status, /\bvoid\s+/);
assert.doesNotMatch(status, /const count = taskCount \|\| 1/);
assert.doesNotMatch(sleepBlocker, /\?[^:\n]+:[^\n]+\?/);
assert.doesNotMatch(dashboard, /\?[^:\n]+:[^\n]+\?/);
assert.doesNotMatch(home, /\?[^:\n]+:[^\n]+\?/);
assert.doesNotMatch(workspaceState, /spawnSync\(['"]git['"]/);
assert.match(workspaceState, /C:\\\\Program Files\\\\Git\\\\cmd\\\\git\.exe/);
assert.match(workspaceState, /resolveGitExecutable/);

console.log('Sonar new-code regression scan passed.');
