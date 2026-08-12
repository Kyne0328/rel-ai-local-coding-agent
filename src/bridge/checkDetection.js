

// Validation-command detection: given a workspace root and a level, work out which
// commands constitute "quick", "standard", or "release" validation for that project.
//
// Split out of validation.js so that file stays focused on *running* checks. The
// detection side is also called from relai_code_inspect diagnostics (three levels in
// one call) and from the dashboard summary on every poll, which is why it caches.

import * as fs from "node:fs";
import * as path from "node:path";
import { discoveryManifestSignature } from "../commandDiscovery.js";
import { buildCheckCatalog } from "../workflow/checkCatalog.js";
import { discoverRepositoryTopology } from "../workflow/topology.js";
import { detectPackageJsonChecks } from './checkDetectionNpm.js';

// Each detection re-reads and re-parses package.json. Cache per (root, level) against
// the same manifest stat signature command discovery uses, so any manifest edit is
// still picked up immediately.
const CHECK_CACHE_LIMIT = 64;
const checkCache = new Map();

function detectVerifyChecks(root, level) {
  const key = `${root}::${level}`;
  const signature = discoveryManifestSignature(root);
  const cached = checkCache.get(key);
  // Copy on the way out: callers place the array straight into tool responses.
  if (cached?.signature === signature) return [...cached.commands];

  const commands = [];
  detectPackageJsonChecks(root, level, commands);
  detectManifestChecks(root, level, commands);
  const unique = [...new Set(commands)];
  if (checkCache.size >= CHECK_CACHE_LIMIT && !checkCache.has(key)) {
    checkCache.delete(checkCache.keys().next().value);
  }
  checkCache.set(key, { signature, commands: unique });
  return [...unique];
}

function detectVerifyCheckUnits(root, level) {
  const topology = discoverRepositoryTopology(root);
  const catalog = buildCheckCatalog(topology);
  const hasNested = topology.packages.some(pkg => pkg.path !== '.');
  if (!hasNested) {
    return detectVerifyChecks(root, level).map((command, index) => {
      const matched = catalog.find(unit => unit.command === command && unit.cwd === '.');
      return matched || { id: `legacy:root:${index}`, packageId: '', cwd: '.', command, kind: 'other', level: level === 'quick' ? 'focused' : 'standard', estimatedCost: 'small', source: 'legacy', scopeKey: 'repository' };
    });
  }
  const rootUnits = detectVerifyChecks(root, level).map((command, index) => {
    const matched = catalog.find(unit => unit.command === command && unit.cwd === '.');
    return matched || { id: `legacy:root:${index}`, packageId: '', cwd: '.', command, kind: 'verification', level: level === 'quick' ? 'focused' : 'standard', estimatedCost: 'small', source: 'legacy', scopeKey: 'repository' };
  });
  const nested = minimalNestedChecks(catalog.filter(unit => unit.cwd !== '.'), level);
  return [...rootUnits, ...nested];
}

function minimalNestedChecks(catalog, level) {
  const allowed = level === 'release'
    ? new Set(['test', 'lint', 'typecheck', 'build', 'dead_code', 'security', 'verification'])
    : level === 'quick' || level === 'focused'
      ? new Set(['lint', 'typecheck', 'format', 'verification'])
      : new Set(['test', 'lint', 'typecheck', 'build', 'verification']);
  const groups = new Map();
  for (const unit of catalog) {
    if (!allowed.has(unit.kind)) continue;
    const key = `${unit.packageId}\u0000${unit.kind}`;
    const items = groups.get(key) || [];
    items.push(unit);
    groups.set(key, items);
  }
  const selected = [];
  for (const items of groups.values()) {
    items.sort((left, right) => checkPreference(left, level) - checkPreference(right, level)
      || left.command.length - right.command.length
      || left.command.localeCompare(right.command));
    selected.push(items[0]);
  }
  return selected;
}

function checkPreference(unit, level) {
  const name = String(unit.id || '').slice(String(unit.packageId || '').length + 1).toLowerCase();
  const preferred = level === 'release'
    ? ['test:all', 'test', 'check', 'verify', 'lint', 'typecheck', 'build']
    : level === 'quick' || level === 'focused'
      ? ['check', 'verify', 'lint', 'typecheck', 'format']
      : ['test', 'check', 'verify', 'lint', 'typecheck', 'build'];
  const index = preferred.indexOf(name);
  return index === -1 ? preferred.length + name.split(':').length : index;
}

function detectManifestChecks(root, level, commands) {
  if (fs.existsSync(path.join(root, "pubspec.yaml"))) {
    if (level === "quick") {
      commands.push("dart analyze");
    } else {
      commands.push("flutter analyze", "flutter test");
    }
  }
  if (fs.existsSync(path.join(root, "pyproject.toml")) || fs.existsSync(path.join(root, "requirements.txt"))) commands.push("python -m pytest");
  if (fs.existsSync(path.join(root, "go.mod"))) commands.push("go test ./...");
  if (fs.existsSync(path.join(root, "Cargo.toml"))) commands.push("cargo test");
}

export { detectVerifyCheckUnits, detectVerifyChecks,  };
