import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const css = read('src/ui/styles/app.css');
const compiledCss = read('public/dashboard.css');
const vscodeSettings = JSON.parse(read('.vscode/settings.json'));
const vscodeExtensions = JSON.parse(read('.vscode/extensions.json'));

assert.match(css, /@import "tailwindcss" source\(none\)/);
assert.match(css, /@source "\.\.\/\*\*\/\*\.js"/);
assert.match(css, /@import "\.\.\/components\/filter-controls\.css"/);
for (const feature of ['home', 'onboarding', 'settings', 'system', 'sessions', 'activity', 'workspaces', 'tools', 'processes']) {
  assert.match(css, new RegExp(`@import "\\.\\.\\/features\\/${feature}\\/styles\\.css"`));
}
assert.equal(vscodeSettings['files.associations']?.['**/src/ui/styles/app.css'], 'tailwindcss');
assert.ok(vscodeExtensions.recommendations?.includes('bradlc.vscode-tailwindcss'));
assert.doesNotMatch(compiledCss, /rel-ai-mcp\\:ngrok|\.\\\[rel-ai-mcp/);
for (const selector of ['.filter-bar', '.filter-drawer', '.desktop-setup-checklist', '.connection-status-body', '.activity-page', '.tools-grid', '.diagnostic-page']) {
  assert.match(compiledCss, new RegExp(selector.replace('.', '\\.')));
}

console.log('Tailwind generated UI ownership contracts passed.');
