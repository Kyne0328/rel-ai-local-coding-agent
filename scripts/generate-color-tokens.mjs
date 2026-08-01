import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderDashboardTokenCss,
  renderElectronTokenCss,
  renderOauthCss,
  renderColorReferenceSvg
} from '../src/ui/colorTokens.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputs = [
  ['src/ui/styles/color-tokens.css', renderDashboardTokenCss()],
  ['electron/renderer/color-tokens.css', renderElectronTokenCss()],
  ['public/oauth.css', renderOauthCss()],
  ['docs/color-system-reference.svg', renderColorReferenceSvg()]
];
const check = process.argv.includes('--check');
const failures = [];
const RETRYABLE_WRITE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM', 'UNKNOWN']);

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function writeGeneratedFile(target, content) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (current === content) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
  try {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        fs.renameSync(temporary, target);
        return;
      } catch (error) {
        if (!RETRYABLE_WRITE_CODES.has(error?.code) || attempt === 6) throw error;
        sleep(attempt * 100);
      }
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

for (const [relativePath, content] of outputs) {
  const target = path.join(root, relativePath);
  if (check) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== content) failures.push(relativePath);
    continue;
  }
  writeGeneratedFile(target, content);
  console.log(`Generated ${relativePath}`);
}
if (failures.length) {
  console.error(`Generated color artifacts are stale: ${failures.join(', ')}`);
  process.exit(1);
}
