

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
  const allowed = level === 'release'
    ? new Set(['test', 'lint', 'typecheck', 'build', 'dead_code', 'security', 'other'])
    : level === 'quick' || level === 'focused'
      ? new Set(['test', 'lint', 'typecheck', 'format', 'other'])
      : new Set(['test', 'lint', 'typecheck', 'build', 'other']);
  return catalog.filter(unit => unit.kind !== 'migration' && allowed.has(unit.kind));
}

function detectPackageJsonChecks(root, level, commands) {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};
    if (level === "release" && scripts["test:all"]) {
      commands.push("npm run test:all");
      if (scripts["electron:build"] && !npmScriptInvokes(scripts, "test:all", "electron:build")) {
        commands.push("npm run electron:build");
      } else if (scripts.build && !npmScriptInvokes(scripts, "test:all", "build")) {
        commands.push("npm run build");
      }
      return;
    }
    const hasStandardTest = level !== "quick" && Boolean(scripts.test);
    const testCoversCheck = hasStandardTest && npmScriptInvokes(scripts, "test", "check");
    if (scripts.check && !testCoversCheck) {
      commands.push("npm run check");
    } else if (level === "quick" && fs.existsSync(path.join(root, "src", "tools.js"))) {
      commands.push("node --check src/tools.js");
    }
    if (hasStandardTest) commands.push(canonicalNpmScriptCommand(scripts, "test"));
    const testCoversBuild = hasStandardTest && npmScriptInvokes(scripts, "test", "build");
    if (scripts.build && !testCoversBuild && shouldRunPackageBuild(root, pkg, scripts, level, commands)) commands.push("npm run build");
  } catch {
    if (level === "quick" && fs.existsSync(path.join(root, "src", "tools.js"))) commands.push("node --check src/tools.js");
  }
}

function npmScriptInvokes(scripts, sourceName, targetName, seen = new Set()) {
  if (!sourceName || seen.has(sourceName)) return false;
  seen.add(sourceName);
  const script = String(scripts?.[sourceName] || "");
  const references = [...script.matchAll(/\bnpm(?:\.cmd)?\s+(?:(?:run|run-script)\s+)?([A-Za-z0-9:_-]+)/g)]
    .map((match) => match[1]);
  for (const reference of references) {
    if (reference === targetName) return true;
    if (npmScriptInvokes(scripts, reference, targetName, seen)) return true;
  }
  return false;
}

function canonicalNpmScriptCommand(scripts, scriptName) {
  const script = String(scripts?.[scriptName] || "").trim();
  const alias = /^npm(?:\.cmd)?\s+(?:run|run-script)\s+([A-Za-z0-9:_-]+)$/.exec(script);
  if (alias) return `npm run ${alias[1]}`;
  return scriptName === "test" ? "npm test" : `npm run ${scriptName}`;
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

function shouldRunPackageBuild(root, pkg, scripts, level, currentCommands) {
  if (level === "quick") return false;
  if (level === "full" || level === "release") return true;
  if (!currentCommands?.length) return true;
  const allDeps = {
    ...(typeof pkg?.dependencies === "object" ? pkg.dependencies : {}),
    ...(typeof pkg?.devDependencies === "object" ? pkg.devDependencies : {})
  };
  const dependencyNames = new Set(Object.keys(allDeps));
  const buildCriticalDeps = ["next", "vite", "nuxt", "astro", "@remix-run/dev", "@sveltejs/kit", "react-scripts", "webpack", "parcel"];
  if (buildCriticalDeps.some((name) => dependencyNames.has(name))) return true;
  const build = String((scripts?.build) || "");
  if (/\b(next|vite|nuxt|astro|remix|svelte-kit|react-scripts|webpack|parcel)\b/i.test(build)) return true;
  if (fs.existsSync(path.join(root, "next.config.js")) || fs.existsSync(path.join(root, "next.config.mjs"))) return true;
  return false;
}

export { detectVerifyCheckUnits, detectVerifyChecks,  };
