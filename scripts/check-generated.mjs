import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runNpm } from './npm-cli.mjs';

const generated = [
  'src/ui/styles/color-tokens.css',
  'electron/renderer/color-tokens.css',
  'docs/color-system-reference.svg'
];
const dashboardCssPath = new URL('../public/dashboard.css', import.meta.url);
const dashboardCssBefore = readIfExists(dashboardCssPath);

const generation = runNpm(['run', 'build:css'], { stdio: 'inherit' });
if (generation.status !== 0) process.exit(generation.status || 1);

const dashboardCssAfter = readIfExists(dashboardCssPath);
if (!dashboardCssBefore.equals(dashboardCssAfter)) {
  console.error('Generated dashboard CSS is stale. Run npm run build:css and keep public/dashboard.css with the source change.');
  process.exit(1);
}

const diff = spawnSync('git', ['diff', '--exit-code', '--', ...generated], { stdio: 'inherit' });
if (diff.status !== 0) {
  console.error('Generated assets are stale. Run npm run build:css and commit the generated results.');
  process.exit(diff.status || 1);
}
console.log('Generated assets are current.');

function readIfExists(file) {
  try { return fs.readFileSync(file); }
  catch (error) {
    if (error?.code === 'ENOENT') return Buffer.alloc(0);
    throw error;
  }
}
