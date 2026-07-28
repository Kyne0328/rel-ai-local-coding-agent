import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function runNpm(args, options = {}) {
  const npmCli = resolveNpmCli();
  return spawnSync(process.execPath, [npmCli, ...args], options);
}

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean);
  const npmCli = candidates.find(candidate => fs.existsSync(candidate));
  if (!npmCli) throw new Error('npm CLI could not be resolved from npm_execpath or the Node.js installation.');
  return npmCli;
}
