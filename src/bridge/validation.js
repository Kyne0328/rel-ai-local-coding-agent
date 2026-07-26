const fs = require("node:fs");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("../process");
const { discoverCommands } = require("../commandDiscovery");
const { normalizeCommandAlias } = require("../commandNormalizer");
const { selectValidationLevel } = require("../validationStrategy");
const { resolvePolicy } = require("../policyResolver");
const { clampNumber } = require("./limits");
const { updateCurrentToolActivity } = require("../toolActivity");
const { finalizeValidationResult, normalizeCompletionSummary } = require("../tools/completion");
const CHECK_OUTPUT_TAIL_DEFAULT = 4000, CHECK_OUTPUT_TAIL_FULL = 40000;
async function relaiVerify(workspace, config, args = {}) {
  const level = String(args.level || "standard").toLowerCase();
  const complete = args.complete === true, completionSummary = complete ? normalizeCompletionSummary(args.summary) : '';
  const { checks, aliasNormalizations } = normalizeVerifyChecks(args, workspace.path, level);
  const { level: validationLevel, reason: validationLevelReason, changedFiles } = selectValidationLevel(workspace.path, workspace, args.validationLevel);
  const policy = resolvePolicy(workspace, config);
  if (checks.length === 0) {
    updateCurrentToolActivity({ operation: `No ${level} validation commands were detected` });
    return {
    ok: false,
    workspace: workspace.alias,
    level,
    checks: [],
    commands: [],
    results: [],
    aliasNormalizations: 0,
    validationLevel,
    validationLevelReason,
    changedFiles,
    policy,
    validated: false,
    validationStatus: "not_run",
    message: "Validation status: NOT RUN. No validation checks were detected or executed. This is not a passed validation. Define a check/test/build script or pass an explicit check."
    };
  }
  const stopOnFailure = args.stopOnFailure !== false, fullOutput = Boolean(args.fullOutput);
  const runConfig = fullOutput
    ? { ...config, maxOutputBytes: Math.max(Number(config.maxOutputBytes) || 0, 16 * 1024 * 1024) }
    : config;
  const tailChars = fullOutput ? CHECK_OUTPUT_TAIL_FULL : CHECK_OUTPUT_TAIL_DEFAULT;
  const results = [];
  for (let index = 0; index < checks.length; index += 1) {
    const command = checks[index];
    updateCurrentToolActivity({
      operation: `Running validation ${index + 1}/${checks.length}: ${command}`,
      detail: command
    });
    const result = await runProcess(command, [], {
      cwd: workspace.path,
      shell: true,
      commandString: command,
      timeout: clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 120000)
    }, runConfig);
    const summary = boundCheckOutput({ command, ...summarizeCommand(result) }, tailChars);
    results.push(summary);
    if (!summary.ok && stopOnFailure) break;
  }
  const ok = results.length === checks.length && results.every((item) => item.ok);
  const nextAction = ok
    ? "Completion is not automatic. If the task is finished, call relai_complete_task once; on future final validations, pass complete:true with summary to validate and close the session atomically."
    : "Fix the failing validation before reporting task completion.";
  const validationResult = {
    ok,
    workspace: workspace.alias,
    level,
    checks,
    commands: checks,
    results,
    aliasNormalizations,
    validationLevel,
    validationLevelReason,
    changedFiles,
    policy,
    validated: results.length > 0,
    validationStatus: ok ? "passed" : "failed",
    nextAction,
    ...(fullOutput ? { fullOutput: true } : {})
  };
  if (!ok || !complete) return validationResult;
  return finalizeValidationResult(config, workspace, validationResult, completionSummary);
}
// Keep the last maxChars of a command stream so the failing tail survives the
// server-level result cap. Prepends a marker noting how much was dropped.
function tailString(text, maxChars) {
  const value = String(text);
  if (value.length <= maxChars) return value;
  return `[rel-ai-mcp kept last ${maxChars} of ${value.length} chars]\n` + value.slice(value.length - maxChars);
}

function boundCheckOutput(summary, maxChars) {
  const bounded = { ...summary };
  if (typeof bounded.stdout === "string") bounded.stdout = tailString(bounded.stdout, maxChars);
  if (typeof bounded.stderr === "string") bounded.stderr = tailString(bounded.stderr, maxChars);
  return bounded;
}

function hasRequestedChecks(args = {}) {
  return Boolean(args.verify || args.check || args.checks || args.checksText || args.command || args.commands || args.commandsText);
}

function normalizeVerifyChecks(args, root, level) {
  const discovered = discoverCommands(root);
  const aliasNormalizations = { count: 0 };
  const resolveAndTrack = makeResolver(discovered, aliasNormalizations);
  const explicit = collectExplicitChecks(args, resolveAndTrack);
  if (explicit.length) return { checks: [...new Set(explicit)], aliasNormalizations: aliasNormalizations.count };
  return { checks: detectVerifyChecks(root, level), aliasNormalizations: aliasNormalizations.count };
}

function makeResolver(discovered, aliasNormalizations) {
  return (raw) => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return trimmed;
    const { command, normalized } = normalizeCommandAlias(trimmed, trimmed, discovered);
    if (normalized) aliasNormalizations.count++;
    return command;
  };
}

function collectExplicitChecks(args, resolveAndTrack) {
  const explicit = [];
  pushResolvedExplicit(explicit, args.check, resolveAndTrack);
  pushResolvedExplicit(explicit, args.command, resolveAndTrack);
  pushResolvedCommands(explicit, args.commands, resolveAndTrack);
  pushResolvedCommandText(explicit, args.commandsText, resolveAndTrack);
  return explicit;
}

function pushResolvedExplicit(target, value, resolveAndTrack) {
  if (typeof value === "string" && value.trim()) target.push(resolveAndTrack(value));
}

function pushResolvedCommands(target, commands, resolveAndTrack) {
  if (!Array.isArray(commands)) return;
  for (const item of commands) {
    const command = resolveAndTrack(String(item || ""));
    if (command) target.push(command);
  }
}

function pushResolvedCommandText(target, commandsText, resolveAndTrack) {
  if (typeof commandsText !== "string" || !commandsText.trim()) return;
  for (const line of commandsText.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith("#")) {
      target.push(resolveAndTrack(trimmedLine));
    }
  }
}

function detectVerifyChecks(root, level) {
  const commands = [];
  detectPackageJsonChecks(root, level, commands);
  detectManifestChecks(root, level, commands);
  return [...new Set(commands)];
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

module.exports = { relaiVerify, hasRequestedChecks, detectVerifyChecks };
