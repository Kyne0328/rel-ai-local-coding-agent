import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SETTINGS_NAV_ITEMS, WORK_NAV_ITEMS } from '../src/ui/navigation-catalog.js';
import { canonicalPathFor } from '../src/ui/route-policy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.deepEqual(SETTINGS_NAV_ITEMS.map(item => item.label), ['Preferences', 'Application', 'Advanced', 'About']);
assert.equal(WORK_NAV_ITEMS.find(item => item.id === 'skills')?.path, 'skills');
assert.equal(canonicalPathFor('skills'), 'skills');
assert.equal(canonicalPathFor('settings/skills'), 'skills');

const settingsIndex = read('src/ui/features/settings/index.js');
assert.doesNotMatch(settingsIndex, /mountSkills|skills:\s*mountSkills/);

const source = read('src/ui/features/skills/index.js');
for (const label of ['Built-in', 'Installed', 'Workspace enabled', 'Install from GitHub', 'Load skills', 'Select all', 'Install selected']) {
  assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(source, /\/api\/skills/);
assert.match(source, /preview_github/);
assert.match(source, /install_github/);
assert.match(source, /set_workspace_skills/);
assert.match(source, /remove_installed/);

console.log('Top-level skill library navigation and interaction contracts passed.');
