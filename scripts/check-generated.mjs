import { spawnSync } from 'node:child_process';
import { runNpm } from './npm-cli.mjs';

const generated = [
  'src/ui/styles/color-tokens.css',
  'electron/renderer/color-tokens.css',
  'public/oauth.css',
  'docs/color-system-reference.svg'
];

const generation = runNpm(['run', 'generate:color-tokens'], { stdio: 'inherit' });
if (generation.status !== 0) process.exit(generation.status || 1);

const diff = spawnSync('git', ['diff', '--exit-code', '--', ...generated], { stdio: 'inherit' });
if (diff.status !== 0) {
  console.error('Generated assets are stale. Run npm run generate:color-tokens and commit the results.');
  process.exit(diff.status || 1);
}
console.log('Generated assets are current.');
