import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getStateDir } from '../statePaths.js';
import { workspaceGitStatus } from '../repo/gitOps.js';
import { relaiCodeInspect } from './codeIntelligence.js';
import { detectVerifyChecks } from './checkDetection.js';

const PLAN_TTL_MS = 30 * 60 * 1000;
const FINGERPRINT_VERSION = 1;
const VALIDATION_CONFIG_PATHS = Object.freeze([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'tsconfig.json',
  'jsconfig.json',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  '.eslintrc',
  '.eslintrc.json',
  'knip.json',
  'knip.jsonc',
  'vitest.config.js',
  'vitest.config.mjs',
  'jest.config.js',
  'jest.config.mjs'
]);

async function createValidationPlan(workspace, config, args = {}) {
  const status = await workspaceGitStatus(workspace, config, { maxBytes: 256 * 1024 });
  const changedFiles = normalizePaths(status.changedFiles || []);
  let impact = { affectedTests: [], impactedPaths: [] };
  if (changedFiles.length) {
    try {
      impact = await relaiCodeInspect(workspace, config, { action: 'impact', paths: changedFiles, maxResults: 200, maxDepth: 3 });
    } catch {}
  }
  const quick = detectVerifyChecks(workspace.path, 'quick');
  const standard = detectVerifyChecks(workspace.path, 'standard');
  const release = detectVerifyChecks(workspace.path, 'release');
  const focused = deriveFocusedChecks(quick, standard, impact.affectedTests || [], workspace);
  const fingerprint = await createValidationFingerprint(workspace, config, status);
  const payload = {
    version: 2,
    workspace: workspace.alias,
    workspacePath: workspace.path,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + PLAN_TTL_MS).toISOString(),
    changedFiles,
    workspaceFingerprint: fingerprint.fingerprint,
    fingerprintVersion: FINGERPRINT_VERSION,
    affectedTests: impact.affectedTests || [],
    impactedPaths: (impact.impactedPaths || []).slice(0, 200),
    checks: { focused, quick, standard, release },
    recommended: args.release === true ? 'release' : (changedFiles.length > 25 ? 'standard' : 'focused')
  };
  const planId = `vplan_${crypto.randomBytes(18).toString('base64url')}`;
  const signature = signPlan(config, planId, payload);
  writePlan(config, planId, { ...payload, planId, signature });
  return { ok: true, ...payload, planId, signature, use: 'Pass planId to relai_validate with action "checks" to execute the content-bound selected plan.' };
}

async function createValidationFingerprint(workspace, config, suppliedStatus = null) {
  const status = suppliedStatus || await workspaceGitStatus(workspace, config, { maxBytes: 256 * 1024 });
  const changedFiles = normalizePaths(status.changedFiles || []);
  const relevantPaths = normalizePaths([
    ...changedFiles,
    ...VALIDATION_CONFIG_PATHS.filter(file => fs.existsSync(path.join(workspace.path, file)))
  ]);
  const descriptor = {
    version: FINGERPRINT_VERSION,
    workspace: workspace.alias,
    head: gitText(workspace.path, ['rev-parse', 'HEAD']),
    indexHash: gitDigest(workspace.path, ['diff', '--cached', '--binary', '--no-ext-diff']),
    worktreeHash: gitDigest(workspace.path, ['diff', '--binary', '--no-ext-diff']),
    changedFiles,
    relevantFiles: relevantPaths.map(file => fingerprintPath(workspace.path, file)),
    checks: {
      quick: detectVerifyChecks(workspace.path, 'quick'),
      standard: detectVerifyChecks(workspace.path, 'standard'),
      release: detectVerifyChecks(workspace.path, 'release')
    },
    workspaceCommands: workspace.commands || {},
    workspaceTestCommands: workspace.testCommands || {}
  };
  return {
    fingerprint: crypto.createHash('sha256').update(stableJson(descriptor)).digest('base64url'),
    version: FINGERPRINT_VERSION,
    changedFiles
  };
}

function fingerprintPath(root, relativePath) {
  const normalized = normalizePath(relativePath);
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { path: normalized, type: 'outside' };
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    return { path: normalized, type: error?.code === 'ENOENT' ? 'missing' : 'unreadable', code: String(error?.code || '') };
  }
  if (stat.isSymbolicLink()) {
    return { path: normalized, type: 'symlink', target: fs.readlinkSync(absolute) };
  }
  if (stat.isDirectory()) return { path: normalized, type: 'directory' };
  if (!stat.isFile()) return { path: normalized, type: 'other', size: stat.size };
  return {
    path: normalized,
    type: 'file',
    size: stat.size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')
  };
}

function gitText(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024
    }).trim();
  } catch {
    return '';
  }
}

function gitDigest(root, args) {
  try {
    const output = execFileSync('git', args, {
      cwd: root,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024
    });
    return crypto.createHash('sha256').update(output).digest('hex');
  } catch {
    return '';
  }
}

function deriveFocusedChecks(quick, standard, affectedTests, workspace) {
  const checks = [...quick];
  for (const testPath of affectedTests.slice(0, 20)) {
    if (testPath.endsWith('.mjs') || testPath.endsWith('.js') || testPath.endsWith('.cjs')) checks.push(`node ${quotePath(testPath)}`);
  }
  if (!checks.length) checks.push(...standard.slice(0, 2));
  for (const command of Object.values(workspace.testCommands || {})) {
    if (affectedTests.some(test => String(command).includes(test))) checks.push(command);
  }
  return [...new Set(checks)];
}

function quotePath(value) {
  const text = String(value);
  return /\s/.test(text) ? JSON.stringify(text) : text;
}

function planDirectory(config) {
  return path.join(getStateDir(config), 'validation-plans');
}

function planPath(config, planId) {
  const value = String(planId || '').trim();
  if (!/^vplan_[A-Za-z0-9_-]{20,100}$/.test(value)) throw new Error('Invalid validation planId.');
  return path.join(planDirectory(config), `${value}.json`);
}

function writePlan(config, planId, payload) {
  fs.mkdirSync(planDirectory(config), { recursive: true, mode: 0o700 });
  const target = planPath(config, planId);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function readValidationPlan(config, planId, workspace) {
  let plan;
  try { plan = JSON.parse(fs.readFileSync(planPath(config, planId), 'utf8')); }
  catch { throw new Error(`Validation plan '${planId}' was not found.`); }
  if (Date.parse(plan.expiresAt || 0) <= Date.now()) throw new Error(`Validation plan '${planId}' expired.`);
  if (workspace && (plan.workspace !== workspace.alias || plan.workspacePath !== workspace.path)) throw new Error('Validation plan belongs to another workspace.');
  if (plan.signature !== signPlan(config, planId, planWithoutSignature(plan))) throw new Error('Validation plan signature is invalid.');
  return plan;
}

function signPlan(config, planId, payload) {
  return crypto.createHmac('sha256', planKey(config)).update(planId).update('\0').update(stableJson(payload)).digest('base64url');
}

function planKey(config) {
  const explicit = String(process.env.REL_AI_REQUEST_STATE_KEY || '').trim();
  if (explicit.length >= 32) return explicit;
  const seed = `${config.stateDir}|${config.auditLogPath}|rel-ai-validation-plan`;
  return crypto.createHash('sha256').update(seed).digest();
}

function planWithoutSignature(plan) {
  const copy = { ...plan };
  delete copy.signature;
  delete copy.planId;
  return copy;
}

function normalizePaths(values) {
  return [...new Set(values.map(normalizePath).filter(Boolean))].sort();
}

function normalizePath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export { createValidationFingerprint, createValidationPlan, readValidationPlan, signPlan };
