import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
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
  const res = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(res.stdout || '');
    console.error(res.stderr || '');
    throw new Error(`Syntax check failed: ${path.relative(root, file)}`);
  }
}
console.log(`Checked ${files.length} JavaScript files.`);
