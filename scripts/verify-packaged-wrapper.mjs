import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

runNode('generated color verification', path.join(root, 'scripts', 'generate-color-tokens.mjs'), ['--check']);
runNode('packaged application verification', path.join(root, 'scripts', 'verify-packaged-app.mjs'), process.argv.slice(2));

function runNode(label, script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
    shell: false
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`, { cause: result.error });
  if (result.signal) throw new Error(`${label} was terminated by ${result.signal}.`);
  if (result.status !== 0) process.exit(result.status || 1);
}
