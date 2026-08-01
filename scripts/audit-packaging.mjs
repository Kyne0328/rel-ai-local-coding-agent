import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function evaluatePackagingAudit({ report, policy, lockfile, now = new Date() }) {
  validatePolicy(policy, now);
  const vulnerabilities = report?.vulnerabilities && typeof report.vulnerabilities === 'object'
    ? report.vulnerabilities
    : {};
  const names = Object.keys(vulnerabilities).sort();
  if (names.length === 0) {
    return { accepted: true, vulnerabilityCount: 0, packages: [], advisoryUrls: [] };
  }
  const critical = Number(report?.metadata?.vulnerabilities?.critical || 0);
  if (critical > 0) throw new Error(`Packaging audit contains ${critical} critical vulnerability finding(s).`);

  const allowedPackages = new Set(policy.allowedPackages);
  const unexpectedPackages = names.filter(name => !allowedPackages.has(name));
  if (unexpectedPackages.length) {
    throw new Error(`Packaging audit contains unapproved package finding(s): ${unexpectedPackages.join(', ')}.`);
  }

  const allowedUrls = new Set(policy.allowedAdvisoryUrls);
  const foundUrls = new Set();
  for (const name of names) {
    const vulnerability = vulnerabilities[name];
    assertBuildOnlyNodes(name, vulnerability?.nodes, lockfile);
    const urls = collectAdvisoryUrls(name, vulnerabilities);
    if (urls.size === 0) throw new Error(`Packaging audit finding ${name} has no traceable advisory URL.`);
    for (const url of urls) {
      foundUrls.add(url);
      if (!allowedUrls.has(url)) throw new Error(`Packaging audit contains unapproved advisory ${url} through ${name}.`);
    }
  }

  return {
    accepted: true,
    vulnerabilityCount: names.length,
    packages: names,
    advisoryUrls: [...foundUrls].sort(),
    expiresOn: policy.expiresOn
  };
}

function validatePolicy(policy, now) {
  if (policy?.schemaVersion !== 1) throw new Error('Unsupported packaging audit policy schema.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(policy.expiresOn || ''))) {
    throw new Error('Packaging audit policy requires an ISO expiration date.');
  }
  const expiration = new Date(`${policy.expiresOn}T23:59:59.999Z`);
  if (!Number.isFinite(expiration.getTime())) throw new Error('Packaging audit policy expiration date is invalid.');
  if (now.getTime() > expiration.getTime()) {
    throw new Error(`Packaging audit risk acceptance expired on ${policy.expiresOn}.`);
  }
  if (!Array.isArray(policy.allowedPackages) || policy.allowedPackages.length === 0) {
    throw new Error('Packaging audit policy must name allowed packages.');
  }
  if (!Array.isArray(policy.allowedAdvisoryUrls) || policy.allowedAdvisoryUrls.length === 0) {
    throw new Error('Packaging audit policy must name allowed advisory URLs.');
  }
}

function assertBuildOnlyNodes(name, nodes, lockfile) {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error(`Packaging audit finding ${name} has no lockfile nodes.`);
  for (const node of nodes) {
    const entry = lockfile?.packages?.[node];
    if (!entry) throw new Error(`Packaging audit node is absent from electron/package-lock.json: ${node}.`);
    if (entry.dev !== true && entry.peer !== true && entry.optional !== true) {
      throw new Error(`Packaging audit finding ${name} reaches a non-build dependency at ${node}.`);
    }
  }
}

function collectAdvisoryUrls(start, vulnerabilities) {
  const urls = new Set();
  const visited = new Set();
  const visit = name => {
    if (visited.has(name)) return;
    visited.add(name);
    const vulnerability = vulnerabilities[name];
    for (const item of Array.isArray(vulnerability?.via) ? vulnerability.via : []) {
      if (typeof item === 'string') visit(item);
      else if (item && typeof item.url === 'string' && item.url.trim()) urls.add(item.url.trim());
    }
  };
  visit(start);
  return urls;
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
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'packaging-audit-policy.json'), 'utf8'));
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package-lock.json'), 'utf8'));
  const report = runNpmAudit();
  const result = evaluatePackagingAudit({ report, policy, lockfile });
  if (result.vulnerabilityCount === 0) {
    console.log('Packaging dependency audit passed without high-severity findings.');
    return;
  }
  console.warn(`Accepted ${result.vulnerabilityCount} build-only packaging finding(s) through ${result.advisoryUrls.join(', ')}.`);
  console.warn(`This fail-closed exception expires on ${result.expiresOn}; production dependency audits remain separate and blocking.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { collectAdvisoryUrls, evaluatePackagingAudit };
