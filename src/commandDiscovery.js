const fs = require("node:fs");
const path = require("node:path");

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

function discoverCommands(workspacePath) {
  const discovered = {};
  const root = String(workspacePath || "");
  try { _discoverNpmScripts(discovered, root); } catch {}
  try { _discoverMakefile(discovered, root); } catch {}
  try { _discoverFlutter(discovered, root); } catch {}
  try { _discoverGo(discovered, root); } catch {}
  try { _discoverCargo(discovered, root); } catch {}
  try { _discoverPython(discovered, root); } catch {}
  return discovered;
}

// A configured command key is "stale" when its saved command string is no longer
// among the auto-discovered commands AND the key itself is not a discovered key.
// Shared by relai_status and the dashboard diagnostics so both classify identically.
function staleCommandKeys(configured = {}, discovered = {}) {
  const discoveredValues = new Set(Object.values(discovered || {}));
  return Object.keys(configured || {}).filter((key) => {
    const cmd = configured[key];
    return cmd && !discoveredValues.has(cmd) && !discovered[key];
  });
}

module.exports = { discoverCommands, staleCommandKeys };
