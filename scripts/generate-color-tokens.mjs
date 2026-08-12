import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderDashboardTokenCss,
  renderElectronTokenCss,
  renderColorReferenceSvg
} from '../src/ui/colorTokens.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputs = [
  ['src/ui/styles/color-tokens.css', renderDashboardTokenCss()],
  ['electron/renderer/color-tokens.css', renderElectronTokenCss()],
  ['docs/color-system-reference.svg', renderColorReferenceSvg()]
];
const check = process.argv.includes('--check');
const failures = [];
for (const [relativePath, content] of outputs) {
  const target = path.join(root, relativePath);
  if (check) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== content) failures.push(relativePath);
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  console.log(`Generated ${relativePath}`);
}
if (failures.length) {
  console.error(`Generated color artifacts are stale: ${failures.join(', ')}`);
  process.exit(1);
}
