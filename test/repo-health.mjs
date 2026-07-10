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
  'src/bridge/archive.js': 120,
  'src/bridge/browser.js': 150,
  'src/bridge/patch.js': 400,
  'src/bridge/review.js': 100,
  'src/bridge/tidy.js': 320,
  'src/bridge/validation.js': 240
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
