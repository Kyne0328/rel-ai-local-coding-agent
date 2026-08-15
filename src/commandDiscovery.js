import * as fs from "node:fs";
import * as path from "node:path";
import { discoverRepositoryTopology } from "./workflow/topology.js";

function _discoverNpmScripts(discovered, root) {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (!pkg?.scripts || typeof pkg.scripts !== "object") return;
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    if (typeof cmd === "string" && cmd.trim()) discovered[`npm:${name}`] = `npm run ${name}`;
  }
}

function _discoverMakefile(discovered, root) {
  const makePath = path.join(root, "Makefile");
  if (!fs.existsSync(makePath)) return;
  const lines = fs.readFileSync(makePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(?:#.*)?$/.exec(line);
    if (match) discovered[`make:${match[1]}`] = `make ${match[1]}`;
  }
}

function _discoverFlutter(discovered, root) {
  if (!fs.existsSync(path.join(root, "pubspec.yaml"))) return;
  discovered["flutter:analyze"] = "flutter analyze";
  discovered["flutter:test"] = "flutter test";
  discovered["dart:analyze"] = "dart analyze";
}

function _discoverGo(discovered, root) {
  if (!fs.existsSync(path.join(root, "go.mod"))) return;
  discovered["go:test"] = "go test ./...";
  discovered["go:build"] = "go build ./...";
  discovered["go:vet"] = "go vet ./...";
}

function _discoverCargo(discovered, root) {
  if (!fs.existsSync(path.join(root, "Cargo.toml"))) return;
  discovered["cargo:test"] = "cargo test";
  discovered["cargo:build"] = "cargo build";
  discovered["cargo:clippy"] = "cargo clippy";
}

function _discoverPython(discovered, root) {
  const hasPyproject = fs.existsSync(path.join(root, "pyproject.toml"));
  const hasRequirements = fs.existsSync(path.join(root, "requirements.txt"));
  if (!hasPyproject && !hasRequirements) return;
  discovered["pytest"] = "pytest";
  discovered["python:lint"] = "python -m flake8";
}

// Command discovery re-reads and re-parses every project manifest, and it runs on the
// snapshot, validation, diagnostics, status, and dashboard paths — several times per
// tool call. Caching against a stat signature of the manifests keeps discovery honest
// (any manifest edit changes the signature) while collapsing repeats to seven stats.
const DISCOVERY_CACHE_LIMIT = 32;
const MAX_DISCOVERY_WARNINGS = 8;
const discoveryCache = new Map();

function discoveryManifestSignature(workspacePath) {
  return discoverRepositoryTopology(String(workspacePath || "")).fingerprint;
}

function cacheDiscovery(root, signature, value, warnings) {
  if (discoveryCache.size >= DISCOVERY_CACHE_LIMIT && !discoveryCache.has(root)) {
    discoveryCache.delete(discoveryCache.keys().next().value);
  }
  discoveryCache.set(root, { signature, value, warnings });
}

function discoverCommands(workspacePath, options = {}) {
  const root = String(workspacePath || "");
  const topology = options.topology || discoverRepositoryTopology(root);
  const signature = topology.fingerprint;
  const cached = discoveryCache.get(root);
  // Hand back a copy: several callers place the result straight into a tool response.
  if (cached?.signature === signature) return { ...cached.value };

  const discovered = {};
  const warnings = [];
  attemptDiscovery('package.json', () => _discoverNpmScripts(discovered, root), warnings);
  attemptDiscovery('Makefile', () => _discoverMakefile(discovered, root), warnings);
  attemptDiscovery('Flutter/Dart', () => _discoverFlutter(discovered, root), warnings);
  attemptDiscovery('Go', () => _discoverGo(discovered, root), warnings);
  attemptDiscovery('Cargo', () => _discoverCargo(discovered, root), warnings);
  attemptDiscovery('Python', () => _discoverPython(discovered, root), warnings);
  attemptDiscovery('nested package manifests', () => projectNestedPackageCommands(discovered, topology), warnings);
  cacheDiscovery(root, signature, discovered, warnings);
  return { ...discovered };
}

function commandDiscoveryWarnings(workspacePath) {
  const root = String(workspacePath || "");
  discoverCommands(root);
  return (discoveryCache.get(root)?.warnings || []).map(item => ({ ...item }));
}

function attemptDiscovery(source, operation, warnings) {
  try {
    operation();
  } catch (error) {
    if (warnings.length >= MAX_DISCOVERY_WARNINGS) return;
    const message = error instanceof Error ? error.message : String(error);
    warnings.push({ source, message: message.slice(0, 500) });
  }
}

function projectNestedPackageCommands(discovered, topology) {
  for (const pkg of topology?.packages || []) {
    if (pkg.path === '.' || pkg.ecosystem !== 'npm') continue;
    for (const [name, command] of Object.entries(pkg.scripts || {})) {
      if (typeof command !== 'string' || !command.trim()) continue;
      discovered[`npm:${pkg.path}:${name}`] = name === 'test' ? 'npm test' : `npm run ${name}`;
    }
  }
}

// A configured command key is "stale" when its saved command string is no longer
// among the auto-discovered commands AND the key itself is not a discovered key.
// Shared by relai_work action "status" and the dashboard diagnostics so both classify identically.
function staleCommandKeys(configured = {}, discovered = {}) {
  const discoveredValues = new Set(Object.values(discovered || {}));
  return Object.keys(configured || {}).filter((key) => {
    const cmd = configured[key];
    return cmd && !discoveredValues.has(cmd) && !discovered[key];
  });
}

export { commandDiscoveryWarnings, discoverCommands, discoveryManifestSignature, staleCommandKeys };
