import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2000, 5000];
const TRANSIENT_AUDIT_FAILURE = /(?:EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|E50[0234]|E429|429 Too Many Requests|50[0234] Service|Service Unavailable|socket hang up)/i;

function isTransientAuditFailure(result = {}) {
  return TRANSIENT_AUDIT_FAILURE.test(`${result.stdout || ''}\n${result.stderr || ''}`);
}

function runAudit(npmCli, prefix) {
  const args = [npmCli, 'audit', '--omit=dev', '--audit-level=high'];
  if (prefix) args.push('--prefix', prefix);
  return spawnSync(process.execPath, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true
  });
}

async function auditTarget(npmCli, label, prefix = '') {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = runAudit(npmCli, prefix);
    if (result.error) throw new Error(`Could not execute npm audit for ${label}: ${result.error.message}`, { cause: result.error });
    if (result.status === 0) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return;
    }
    if (!isTransientAuditFailure(result) || attempt === MAX_ATTEMPTS) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = Number.isInteger(result.status) ? result.status : 1;
      throw new Error(`npm audit failed for ${label}.`);
    }
    const delay = RETRY_DELAYS_MS[attempt - 1] || RETRY_DELAYS_MS.at(-1) || 0;
    console.warn(`npm audit for ${label} hit a transient registry error; retrying (${attempt + 1}/${MAX_ATTEMPTS}).`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

async function main() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !fs.existsSync(npmCli)) {
    throw new Error('npm_execpath is unavailable; run this gate through npm run audit:production.');
  }
  await auditTarget(npmCli, 'root dependencies');
  await auditTarget(npmCli, 'Electron dependencies', 'electron');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    if (!process.exitCode) process.exitCode = 1;
    console.error(error instanceof Error ? error.message : String(error));
  }
}

export { isTransientAuditFailure };
