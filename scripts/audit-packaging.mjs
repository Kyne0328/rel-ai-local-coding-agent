import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function evaluatePackagingAudit({ report }) {
  const vulnerabilities = report?.vulnerabilities && typeof report.vulnerabilities === 'object'
    ? report.vulnerabilities
    : {};
  const high = Number(report?.metadata?.vulnerabilities?.high || 0);
  const critical = Number(report?.metadata?.vulnerabilities?.critical || 0);
  if (high > 0 || critical > 0) {
    const packages = Object.keys(vulnerabilities).sort();
    const severity = [
      critical > 0 ? `${critical} critical` : '',
      high > 0 ? `${high} high` : ''
    ].filter(Boolean).join(' and ');
    throw new Error(`Packaging audit contains ${severity} vulnerability finding(s)${packages.length ? `: ${packages.join(', ')}` : ''}.`);
  }
  return { accepted: true, vulnerabilityCount: 0, packages: [] };
}

function runNpmAudit() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !fs.existsSync(npmCli)) {
    throw new Error('npm_execpath is unavailable; run this gate through npm run audit:packaging.');
  }
  const result = spawnSync(process.execPath, [npmCli, 'audit', '--prefix', 'electron', '--audit-level=high', '--json'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true
  });
  if (result.error) throw new Error(`Could not execute npm audit: ${result.error.message}`, { cause: result.error });
  let report;
  try {
    report = JSON.parse(result.stdout || '');
  } catch {
    throw new Error(`npm audit did not return valid JSON. ${String(result.stderr || '').trim()}`.trim());
  }
  return report;
}

function main() {
  const report = runNpmAudit();
  evaluatePackagingAudit({ report });
  console.log('Packaging dependency audit passed without high-severity findings.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { evaluatePackagingAudit };
