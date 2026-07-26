import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const PRODUCTION_APP_ID = 'com.relai.mcp';
export const TEST_APP_ID_PREFIX = 'com.relai.mcp.test.';
export const OWNERSHIP_MARKER = '.relai-installer-test-owner.json';

export function createInstallerTestContext(env = process.env, options = {}) {
  assert.equal(env.REL_AI_INSTALLER_TEST_ISOLATED, '1',
    'Installer lifecycle tests are destructive and require REL_AI_INSTALLER_TEST_ISOLATED=1 in a disposable environment.');

  const runId = normalizeRunId(options.runId || env.REL_AI_INSTALLER_TEST_RUN_ID || crypto.randomUUID());
  const requestedRoot = String(options.testRoot || env.REL_AI_INSTALLER_TEST_ROOT || '').trim();
  const testRoot = path.resolve(requestedRoot || fs.mkdtempSync(path.join(os.tmpdir(), `relai-installer-${runId}-`)));
  assertSafeTestRoot(testRoot);

  const productionInstallation = detectProductionInstallation(env);
  assert.equal(productionInstallation.installed, false,
    `Production Rel.AI MCP installation detected; refusing installer lifecycle test: ${productionInstallation.existingPaths.join(', ')}`);

  const allowProductionIdentity = env.REL_AI_ALLOW_PRODUCTION_INSTALLER_TEST === '1';
  if (allowProductionIdentity) {
    assert.equal(env.GITHUB_ACTIONS, 'true',
      'Production-identity installer validation is permitted only on a disposable GitHub Actions runner.');
    assert.ok(String(env.RUNNER_TEMP || '').trim(), 'RUNNER_TEMP is required for production-identity installer validation.');
    assertPathInside(testRoot, path.resolve(env.RUNNER_TEMP), 'installer test root');
  }

  fs.mkdirSync(testRoot, { recursive: true });
  const marker = {
    schemaVersion: 1,
    runId,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    testRoot
  };
  fs.writeFileSync(path.join(testRoot, OWNERSHIP_MARKER), `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx' });

  return {
    runId,
    testRoot,
    allowProductionIdentity,
    productionInstallation,
    appId: `${TEST_APP_ID_PREFIX}${runId}`,
    productName: `Rel.AI MCP Test ${runId}`,
    executableName: `RelAI-MCP-Test-${runId}`
  };
}

export function assertSafeTestRoot(target) {
  const resolved = path.resolve(String(target || ''));
  const parsed = path.parse(resolved);
  assert.ok(String(target || '').trim(), 'Destructive target must not be empty.');
  assert.notEqual(resolved, parsed.root, 'Filesystem roots cannot be installer test roots.');
  assert.notEqual(resolved, path.resolve(os.homedir()), 'The user home directory cannot be an installer test root.');
  for (const profileRoot of [process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean)) {
    assert.notEqual(resolved, path.resolve(profileRoot), 'Profile data roots cannot be installer test roots.');
  }
  for (const value of productionAndSystemPaths()) {
    const protectedPath = path.resolve(value);
    const relative = path.relative(protectedPath, resolved);
    assert.ok(relative.startsWith('..') || path.isAbsolute(relative),
      `Production or system application paths cannot be installer test roots: ${protectedPath}`);
  }
  return resolved;
}

export function productionAndSystemPaths(env = process.env) {
  const values = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
  if (env.LOCALAPPDATA) {
    values.push(path.join(env.LOCALAPPDATA, 'Programs', 'Rel.AI MCP'));
    values.push(path.join(env.LOCALAPPDATA, 'rel-ai-mcp-updater'));
  }
  if (env.APPDATA) values.push(path.join(env.APPDATA, 'Rel.AI MCP'));
  return [...new Set(values.map(value => path.resolve(value)))];
}

export function detectProductionInstallation(env = process.env) {
  const candidates = productionAndSystemPaths(env).filter(candidate => /rel[.-]?ai mcp|rel-ai-mcp-updater/i.test(candidate));
  return {
    installed: candidates.some(candidate => fs.existsSync(candidate)),
    existingPaths: candidates.filter(candidate => fs.existsSync(candidate)),
    candidates
  };
}

export function assertPathInside(target, parent, label = 'path') {
  const resolvedTarget = path.resolve(String(target || ''));
  const resolvedParent = path.resolve(String(parent || ''));
  const relative = path.relative(resolvedParent, resolvedTarget);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${label} must be a child of ${resolvedParent}.`);
  return resolvedTarget;
}

export function assertOwnedTestRoot(testRoot, runId) {
  assertSafeTestRoot(testRoot);
  const markerPath = path.join(path.resolve(testRoot), OWNERSHIP_MARKER);
  assert.ok(fs.existsSync(markerPath), `Installer test ownership marker is missing: ${markerPath}`);
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.equal(marker.runId, runId, 'Installer test ownership marker belongs to another run.');
  assert.equal(path.resolve(marker.testRoot), path.resolve(testRoot), 'Installer test ownership marker targets another root.');
  return marker;
}

export function removeOwnedTestRoot(testRoot, runId) {
  assertOwnedTestRoot(testRoot, runId);
  fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

export function normalizeRunId(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  assert.match(normalized, /^[a-z0-9]{6,20}$/, 'Installer test run ID must contain 6-20 lowercase letters or digits.');
  return normalized;
}
