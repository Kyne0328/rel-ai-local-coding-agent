const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { publicConfigSummary, resolveWorkspace, writeConfig, readConfig, getConfigPath, makeDefaultConfig } = require("./config");
const { discoverCommands, staleCommandKeys } = require("./commandDiscovery");
const { resolvePolicy } = require("./policyResolver");
const { readAudit, getStateDir } = require("./audit");
const { runProcess, summarizeCommand } = require("./process");
const { safeReadJson } = require("./safety");

function dashboardData(config, args = {}) {
  const limit = clampNumber(args.limit || 100, 1, 500);
  const auditTail = readAudit(config, { limit: Math.min(limit, 200) });
  const health = healthMonitor(config, { limit: 25 });
  const configSummary = publicConfigSummary(config);
  const cs = cautionSummary(config, { windowHours: 24, limit: 500 });
  const cautionByAlias = new Map(cs.workspaces.map((w) => [w.alias, w]));
  if (Array.isArray(configSummary.workspaces)) {
    for (const ws of configSummary.workspaces) {
      ws.sessionPolicy = resolvePolicy({ alias: ws.alias }, config);
      const c = cautionByAlias.get(ws.alias);
      ws.caution = { count: c ? c.count : 0, recent: c ? c.recent : [] };
    }
  }
  // Single authoritative public-tool list so the UI never hardcodes literals that
  // drift from PUBLIC_HTTP_TOOL_NAMES. Lazy require avoids any load-order cycle.
  let publicTools = Array.isArray(configSummary.localRepoBridge?.visibleTools) ? configSummary.localRepoBridge.visibleTools : [];
  try { publicTools = require("./tools").getPublicToolSchemas(config).map((tool) => tool.name); } catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] public tool schema discovery:', error); }
  const toolCount = publicTools.length;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    config: configSummary,
    toolCount,
    counts: {
      auditEntries: auditTail.entries ? auditTail.entries.length : 0,
      workspaces: Object.keys(config.workspaces || {}).length
    },
    workflow: {
      mode: (config.workflow && config.workflow.mode) || "standard",
      tools: publicTools
    },
    health,
    auditTail
  };
}

function liveLogTail(config, args = {}) {
  const limit = clampNumber(args.limit || 100, 1, 1000);
  const audit = readAudit(config, { limit });
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: config.auditLogPath,
    entries: audit.entries || [],
    count: audit.entries ? audit.entries.length : 0
  };
}

function healthMonitor(config, _args = {}) {
  const findings = [];
  const stateDir = getStateDir(config);
  checkDir(findings, "stateDir", stateDir, true);
  checkFile(findings, "config", getConfigPath(), false);

  const staleHours = Number(config.productUx && config.productUx.staleHours || 24);
  const workspaces = Object.keys(config.workspaces || {}).map((alias) => {
    try {
      const workspace = resolveWorkspace(config, alias);
      return { alias, ok: true, path: workspace.path, fastTask: workspace.fastTask || {} };
    } catch (error) {
      findings.push({ severity: "error", code: "workspace_unavailable", workspace: alias, message: error instanceof Error ? error.message : String(error) });
      return { alias, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  return {
    ok: !findings.some((item) => item.severity === "error"),
    generatedAt: new Date().toISOString(),
    staleHours,
    stateDir,
    workspaces,
    counts: {
      workspaces: workspaces.length,
      findings: findings.length
    },
    findings
  };
}

function cleanupPreview(config, args = {}) {
  return cleanupPlan(config, false, args);
}

function cleanupRun(config, args = {}) {
  if (args.confirm !== true) throw new Error("cleanupRun requires confirm=true.");
  return cleanupPlan(config, true, args);
}

function cleanupPlan(config, apply, args = {}) {
  const stateDir = getStateDir(config);
  const olderThanHours = clampNumber(args.olderThanHours || (config.productUx && config.productUx.cleanupOlderThanHours) || 168, 1, 24 * 365);
  const includeAudit = args.includeAudit === true;
  const targets = [];
  if (includeAudit) collectOldJson(targets, path.dirname(config.auditLogPath), olderThanHours, [path.basename(config.auditLogPath)]);
  // Stale staged-write/patch payload dirs (interrupted edits) and old per-workspace
  // operation journals — these accumulate during normal use and nothing else clears them.
  collectOldDirs(targets, path.join(stateDir, "fast"), olderThanHours, /^payload-/);
  collectOldJson(targets, path.join(stateDir, "operation-journal"), olderThanHours, [".jsonl"]);
  const limited = targets.slice(0, clampNumber(args.maxClears || 500, 1, 5000));
  const cleared = [];
  if (apply) {
    for (const file of limited) {
      try {
        fs.rmSync(file.path, { recursive: file.type === "dir", force: true });
        cleared.push(file);
      } catch (error) {
        file.error = error instanceof Error ? error.message : String(error);
      }
    }
  }
  return {
    ok: true,
    dryRun: !apply,
    olderThanHours,
    totalCandidates: targets.length,
    candidates: limited,
    cleared,
    message: apply ? `Cleared ${cleared.length} file(s).` : "Preview only. Re-run with confirm=true to clear candidates."
  };
}

async function doctorFix(config, args = {}) {
  const fixes = [];
  const rawWorkspace = String(args.workspacePath || "");
  if (rawWorkspace && (rawWorkspace.includes("..") || rawWorkspace.includes("~"))) {
    throw new Error("workspacePath must not contain path traversal patterns");
  }
  const workspacePath = rawWorkspace ? path.resolve(rawWorkspace) : "";
  if (workspacePath) {
    if (!fs.existsSync(workspacePath)) throw new Error(`workspacePath does not exist: ${workspacePath}`);
    const attrs = path.join(workspacePath, ".gitattributes");
    const editor = path.join(workspacePath, ".editorconfig");
    if (!fs.existsSync(attrs) || args.overwrite === true) {
      fs.writeFileSync(attrs, "* text=auto eol=lf\n*.bat text eol=crlf\n*.cmd text eol=crlf\n", "utf8");
      fixes.push({ path: attrs, action: "wrote .gitattributes" });
    }
    if (!fs.existsSync(editor) || args.overwrite === true) {
      fs.writeFileSync(editor, "root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\nindent_style = space\nindent_size = 2\n\n[*.{bat,cmd}]\nend_of_line = crlf\n", "utf8");
      fixes.push({ path: editor, action: "wrote .editorconfig" });
    }
    if (args.renormalize === true) {
      const result = await runProcess("git", ["add", "--renormalize", "."], { cwd: workspacePath, local: false }, config);
      fixes.push({ action: "git add --renormalize .", result: summarizeCommand(result) });
    }
  }
  fs.mkdirSync(getStateDir(config), { recursive: true, mode: 0o700 });
  fixes.push({ path: getStateDir(config), action: "ensured stateDir" });
  return { ok: true, fixes, message: fixes.length ? "Doctor fixes completed." : "Nothing to fix." };
}

function setupWizard(args = {}) {
  const workspacePath = args.workspacePath ? path.resolve(String(args.workspacePath)) : "";
  const alias = String(args.alias || "myapp").trim();
  const token = args.generateToken === false ? "" : crypto.randomBytes(24).toString("hex");
  const config = makeDefaultConfig();
  if (workspacePath) {
    config.workspaces[alias] = {
      path: workspacePath,
      testCommands: guessTestCommands(workspacePath),
      commands: {},
      protectedBranches: ["main", "master"],
      defaultBaseBranch: "main",
      allowedRemotes: ["origin"]
    };
  }
  const startCmd = setupStartCommand(token);
  return {
    ok: true,
    configPath: getConfigPath(),
    suggestedToken: token,
    config,
    nextCommands: [
      "npm run init-config",
      workspacePath ? `npm run workspace:add -- ${alias} ${workspacePath}` : "npm run workspace:add -- myapp /absolute/path/to/project",
      startCmd
    ]
  };
}

function setupStartCommand(token) {
  if (!token) return "npm run start:http -- --host 127.0.0.1 --port 3333";
  if (process.platform === "win32") {
    return `$env:REL_AI_MCP_TOKEN='${token}'; npm run start:http -- --host 127.0.0.1 --port 3333`;
  }
  return `REL_AI_MCP_TOKEN=${token} npm run start:http -- --host 127.0.0.1 --port 3333`;
}

function importOriginalRelAiConfig(args = {}) {
  const sourcePath = args.sourcePath ? path.resolve(String(args.sourcePath)) : path.join(os.homedir(), ".rel-ai", "opencode.json");
  if (!fs.existsSync(sourcePath)) throw new Error(`Original Rel.AI config not found: ${sourcePath}`);
  const source = safeReadJson(sourcePath);
  if (!source) throw new Error(`Original Rel.AI config file is corrupted or empty: ${sourcePath}`);
  const config = readConfig({ allowMissing: true });
  const imported = [];
  for (const [alias, entry] of Object.entries(source.workspaces || {})) {
    if (!entry || !entry.path) continue;
    config.workspaces[alias] = config.workspaces[alias] || {};
    config.workspaces[alias].path = entry.path;
    config.workspaces[alias].testCommands = entry.testCommands || config.workspaces[alias].testCommands || {};
    config.workspaces[alias].commands = config.workspaces[alias].commands || {};
    config.workspaces[alias].protectedBranches = config.workspaces[alias].protectedBranches || ["main", "master"];
    imported.push(alias);
  }
  if (args.dryRun !== true) writeConfig(config);
  return { ok: true, dryRun: args.dryRun === true, sourcePath, imported, configPath: getConfigPath() };
}

function stateExport(config, args = {}) {
  if (config.productUx && config.productUx.enableStateExport === false) {
    throw new Error("State export is disabled (productUx.enableStateExport=false).");
  }
  const stateDir = getStateDir(config);
  const maxFiles = clampNumber(args.maxFiles || 2000, 1, 20000);
  const files = [];
  walkState(stateDir, stateDir, files, maxFiles, clampNumber(args.maxFileBytes || 1024 * 1024, 1000, 10 * 1024 * 1024));
  const payload = { version: 1, exportedAt: new Date().toISOString(), stateDir, files };
  if (args.outputPath) {
    const out = path.resolve(String(args.outputPath));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
    return { ok: true, outputPath: out, fileCount: files.length };
  }
  return { ok: true, fileCount: files.length, export: payload };
}

function stateImport(config, args = {}) {
  if (args.confirm !== true) throw new Error("stateImport requires confirm=true.");
  let payload = args.payload;
  if (args.inputPath) {
    payload = safeReadJson(path.resolve(String(args.inputPath)));
    if (!payload) throw new Error(`State import file is corrupted or empty: ${args.inputPath}`);
  }
  if (!payload || !Array.isArray(payload.files)) throw new Error("State import payload must contain a files array.");
  const stateDir = getStateDir(config);
  const written = [];
  for (const item of payload.files) {
    if (!item || !item.path || typeof item.content !== "string") continue;
    const relative = String(item.path).replaceAll("\\", "/");
    if (relative.startsWith("/") || relative.includes("..")) throw new Error(`Unsafe state path: ${relative}`);
    const target = path.join(stateDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, item.content, { mode: 0o600 });
    written.push(relative);
  }
  return { ok: true, stateDir, writtenCount: written.length, written: written.slice(0, 200) };
}

function guessTestCommands(workspacePath) {
  const out = {};
  if (!workspacePath || !fs.existsSync(workspacePath)) return out;
  const pkgPath = path.join(workspacePath, "package.json");
  if (fs.existsSync(pkgPath)) {
    // Only suggest scripts that actually exist, so we don't seed stale aliases the
    // dashboard's alias-consistency check then flags.
    let scripts = {};
    try { scripts = (safeReadJson(pkgPath) || {}).scripts || {}; } catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] package script discovery:', error); }
    if (scripts.test) out.test = "npm test";
    if (scripts.lint) out.lint = "npm run lint";
  }
  if (fs.existsSync(path.join(workspacePath, "pyproject.toml")) || fs.existsSync(path.join(workspacePath, "requirements.txt"))) out.pytest = "pytest";
  if (fs.existsSync(path.join(workspacePath, "Cargo.toml"))) out.cargo = "cargo test";
  if (fs.existsSync(path.join(workspacePath, "go.mod"))) out.go = "go test ./...";
  return out;
}

function checkDir(findings, name, dir, createSuggested) {
  if (!dir) return findings.push({ severity: "error", code: `${name}_missing`, message: `${name} is not configured.` });
  if (!fs.existsSync(dir)) return findings.push({ severity: createSuggested ? "warning" : "error", code: `${name}_not_found`, message: `${name} does not exist: ${dir}` });
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) findings.push({ severity: "error", code: `${name}_not_directory`, message: `${name} is not a directory: ${dir}` });
  } catch (error) {
    findings.push({ severity: "error", code: `${name}_stat_failed`, message: error instanceof Error ? error.message : String(error) });
  }
}

function checkFile(findings, name, file, optional) {
  if (!fs.existsSync(file) && !optional) findings.push({ severity: "error", code: `${name}_missing`, message: `${name} file does not exist: ${file}` });
}

function collectOldJson(targets, dir, olderThanHours, suffixes) {
  if (!dir || !fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectOldJson(targets, full, olderThanHours, suffixes);
    else if (suffixes.some((suffix) => entry.name.endsWith(suffix) || entry.name === suffix)) {
      const stat = fs.statSync(full);
      if (Date.now() - stat.mtimeMs > olderThanHours * 3600000) targets.push({ path: full, type: "file", size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
}

// Recursively find directories whose name matches `namePattern` and whose mtime is
// older than the cutoff (e.g. abandoned staged-edit payload dirs).
function collectOldDirs(targets, root, olderThanHours, namePattern) {
  if (!root || !fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (namePattern.test(entry.name)) {
      const stat = fs.statSync(full);
      if (Date.now() - stat.mtimeMs > olderThanHours * 3600000) targets.push({ path: full, type: "dir", modifiedAt: stat.mtime.toISOString() });
    } else {
      collectOldDirs(targets, full, olderThanHours, namePattern);
    }
  }
}

function walkState(root, current, files, maxFiles, maxFileBytes) {
  if (!fs.existsSync(current) || files.length >= maxFiles) return;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (files.length >= maxFiles) break;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) walkState(root, full, files, maxFiles, maxFileBytes);
    else {
      const stat = fs.statSync(full);
      if (stat.size > maxFileBytes) continue;
      const relative = path.relative(root, full).replaceAll("\\", "/");
      files.push({ path: relative, modifiedAt: stat.mtime.toISOString(), content: fs.readFileSync(full, "utf8") });
    }
  }
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

function cautionSummary(config, options = {}) {
  const windowHours = clampNumber(options.windowHours || 24, 1, 720);
  const limit = clampNumber(options.limit || 200, 1, 2000);
  const cutoffMs = Date.now() - windowHours * 3600000;
  const { entries } = readAudit(config, { limit });
  const byAlias = {};
  for (const e of entries || []) {
    if (!e || e.cautionLevel !== "caution") continue;
    const ts = Date.parse(e.ts || "");
    if (!Number.isFinite(ts) || ts < cutoffMs) continue;
    const alias = e.workspace || "__unknown__";
    if (!byAlias[alias]) byAlias[alias] = { alias, count: 0, recent: [] };
    byAlias[alias].count += 1;
    if (byAlias[alias].recent.length < 5) {
      byAlias[alias].recent.push({ tool: e.tool, ts: e.ts || null, reason: e.cautionReason || null });
    }
  }
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    windowHours,
    workspaces: Object.values(byAlias)
  };
}

function aliasConsistencyCheck(config) {
  const results = [];
  for (const [alias, ws] of Object.entries(config.workspaces || {})) {
    // Cover BOTH command maps, matching relai_status. Checking only testCommands made
    // the dashboard report "All consistent" while relai_status flagged a stale entry in
    // the plain commands map — two surfaces disagreeing about the same workspace.
    const allConfigured = { ...(ws.commands || {}), ...(ws.testCommands || {}) };
    const configuredKeys = Object.keys(allConfigured);
    let discovered = {};
    try { discovered = discoverCommands(ws.path || ''); } catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] alias command discovery:', error); }
    const discoveredKeys = Object.keys(discovered);
    const staleKeys = staleCommandKeys(allConfigured, discovered);
    results.push({ alias, configuredKeys, discoveredKeys, staleKeys, ok: staleKeys.length === 0 });
  }
  return { ok: results.every(r => r.ok), generatedAt: new Date().toISOString(), workspaces: results };
}

module.exports = {
  dashboardData,
  liveLogTail,
  healthMonitor,
  aliasConsistencyCheck,
  cautionSummary,
  cleanupPreview,
  cleanupRun,
  doctorFix,
  setupWizard,
  importOriginalRelAiConfig,
  stateExport,
  stateImport
};
