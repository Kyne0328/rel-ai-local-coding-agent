const fs = require("node:fs");
const path = require("node:path");

function discoverCommands(workspacePath) {
  const discovered = {};
  const root = String(workspacePath || "");

  try {
    const pkgPath = path.join(root, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg && pkg.scripts && typeof pkg.scripts === "object") {
        for (const [name, cmd] of Object.entries(pkg.scripts)) {
          if (typeof cmd === "string" && cmd.trim()) discovered[`npm:${name}`] = `npm run ${name}`;
        }
      }
    }
  } catch (_error) {}

  try {
    const makePath = path.join(root, "Makefile");
    if (fs.existsSync(makePath)) {
      const lines = fs.readFileSync(makePath, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(?:#.*)?$/.exec(line);
        if (match) discovered[`make:${match[1]}`] = `make ${match[1]}`;
      }
    }
  } catch (_error) {}

  try {
    if (fs.existsSync(path.join(root, "pubspec.yaml"))) {
      discovered["flutter:analyze"] = "flutter analyze";
      discovered["flutter:test"] = "flutter test";
      discovered["dart:analyze"] = "dart analyze";
    }
  } catch (_error) {}

  try {
    if (fs.existsSync(path.join(root, "go.mod"))) {
      discovered["go:test"] = "go test ./...";
      discovered["go:build"] = "go build ./...";
      discovered["go:vet"] = "go vet ./...";
    }
  } catch (_error) {}

  try {
    if (fs.existsSync(path.join(root, "Cargo.toml"))) {
      discovered["cargo:test"] = "cargo test";
      discovered["cargo:build"] = "cargo build";
      discovered["cargo:clippy"] = "cargo clippy";
    }
  } catch (_error) {}

  try {
    const hasPyproject = fs.existsSync(path.join(root, "pyproject.toml"));
    const hasRequirements = fs.existsSync(path.join(root, "requirements.txt"));
    if (hasPyproject || hasRequirements) {
      discovered["pytest"] = "pytest";
      discovered["python:lint"] = "python -m flake8";
    }
  } catch (_error) {}

  return discovered;
}

module.exports = { discoverCommands };
