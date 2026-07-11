import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = packageJson.scripts || {};
const ciDir = path.join(root, '.github', 'workflows');
const failures = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.ya?ml$/i.test(entry.name)) out.push(full);
  }
  return out;
}

for (const file of walk(ciDir)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/npm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
    const script = match[1];
    if (!scripts[script]) {
      failures.push(`${path.relative(root, file)} references missing npm script: ${script}`);
    }
  }
}

const sourceLineBudgets = {
  'src/localRepoBridge.js': 900,
  'src/bridge/browser.js': 150,
  'src/bridge/patch.js': 400,
  'src/bridge/review.js': 100,
  'src/bridge/tidy.js': 320,
  'src/bridge/validation.js': 240,
  'src/tools.js': 140,
  'src/tools/registry.js': 520,
  'src/tools/schema.js': 120,
  'src/tools/handlers.js': 180,
  'src/tools/connector.js': 180,
  'src/tools/errors.js': 120,
  'src/tools/session.js': 220,
  'src/tools/status.js': 360,
  'src/tools/dispatch.js': 80,
  'src/httpServer.js': 300,
  'src/http/dashboard.js': 400,
  'src/http/mcp.js': 240,
  'src/http/io.js': 220,
  'src/http/auth.js': 120,
  'electron/main.js': 500,
  'electron/dashboard-window.js': 220,
  'electron/ipc-handlers.js': 100,
  'electron/launcher-config.js': 100,
  'electron/window-size.js': 100,
  'electron/resource-path.js': 50,
  'electron/installed-smoke.js': 180,
  'src/ui/sections/workspaces.js': 40,
  'src/ui/sections/workspace-cards.js': 240,
  'src/ui/sections/workspace-actions.js': 280
};

for (const [relativePath, maxLines] of Object.entries(sourceLineBudgets)) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) {
    failures.push(`Missing architecture module: ${relativePath}`);
    continue;
  }
  const lineCount = fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
  if (lineCount > maxLines) {
    failures.push(`${relativePath} has ${lineCount} lines; architecture budget is ${maxLines}`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log('Repo health checks passed.');
