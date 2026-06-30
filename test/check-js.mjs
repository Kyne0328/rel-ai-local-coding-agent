import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', '.git']);
const files = [];

function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (/\.(?:js|mjs)$/.test(item.name)) files.push(full);
  }
}

walk(root);

for (const file of files.sort()) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  const parseAsModule = file.endsWith('.mjs') || /(^|\n)\s*(import|export)\s/m.test(source);
  const args = parseAsModule ? ['--input-type=module', '--check'] : ['--check', file];
  const options = parseAsModule
    ? { cwd: root, encoding: 'utf8', input: source }
    : { cwd: root, encoding: 'utf8' };
  const res = spawnSync(process.execPath, args, options);
  if (res.status !== 0) {
    console.error(res.stdout || '');
    console.error(res.stderr || '');
    throw new Error(`Syntax check failed: ${relative}`);
  }
}

console.log(`Checked ${files.length} JavaScript files.`);
