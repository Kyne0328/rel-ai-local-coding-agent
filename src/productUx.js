import { getToolSchemas } from './tools.js';
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { publicConfigSummary, resolveWorkspace, writeConfig, readConfig, getConfigPath, makeDefaultConfig } from "./config.js";
import { discoverCommands, staleCommandKeys } from "./commandDiscovery.js";
import { resolvePolicy } from "./policyResolver.js";
import { readAudit } from './audit.js';
import { getStateDir } from './statePaths.js';
import { runProcess, summarizeCommand } from "./process.js";
import { safeReadJson, validateRelativePath } from "./safety.js";

function dashboardData(config, args = {}) {
  const limit = clampNumber(args.limit || 100, 1, 500);
  const auditLimit = Math.min(limit, 200);
  const auditSource = readAudit(config, { limit: Math.max(auditLimit, 500) });
  const auditTail = { ...auditSource, entries: auditSource.entries.slice(-auditLimit) };
  const health = healthMonitor(config, { limit: 25 });
  const configSummary = publicConfigSummary(config);
  const cs = cautionSummary(config, { windowHours: 24, limit: 500, entries: auditSource.entries });
  const cautionByAlias = new Map(cs.workspaces.map((w) => [w.alias, w]));
  if (Array.isArray(configSummary.workspaces)) {
    for (const ws of configSummary.workspaces) {
      ws.sessionPolicy = resolvePolicy({ alias: ws.alias }, config);
      const c = cautionByAlias.get(ws.alias);
      ws.caution = { count: c ? c.count : 0, recent: c ? c.recent : [] };
    }
  }
  // Read the active connector registry so the dashboard never hardcodes tool names.
  let tools = Array.isArray(configSummary.localRepoBridge?.visibleTools) ? configSummary.localRepoBridge.visibleTools : [];
  try { tools = getToolSchemas().map((tool) => tool.name); } catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] tool schema discovery:', error); }
  const toolCount = tools.length;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    config: configSummary,
    toolCount,
    counts: {
      auditEntries: auditTail.entries?.length || 0,
      workspaces: configSummary.workspaces?.length || 0
    },
    tools,
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
    count: audit.entries?.length || 0
  };
}

function healthMonitor(config, _args = {}) {
  const findings = [];
  const stateDir = getStateDir(config);
  checkDir(findings, "stateDir", stateDir, true);
  checkFile(findings, "config", getConfigPath(), false);

  const staleHours = Number(config.productUx?.staleHours || 24);
  checkStaleFile(findings, "audit", config.auditLogPath, staleHours);
  const aliases = Object.keys(config.workspaces || {}).sort(compareText);
  const workspaces = aliases.map((alias) => {
    try {
      const workspace = resolveWorkspace(config, alias);
      return { alias, ok: true, path: workspace.path, context: workspace.context || {} };
    } catch (error) {
      findings.push({ severity: "error", code: "workspace_unavailable", workspace: alias, message: error instanceof Error ? error.message : String(error) });
      return { alias, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const orderedFindings = [...findings].sort(compareHealthFindings);

  return {
    ok: !orderedFindings.some((item) => item.severity === "error"),
    generatedAt: new Date().toISOString(),
    staleHours,
    stateDir,
    workspaces,
    counts: {
      workspaces: workspaces.length,
      findings: orderedFindings.length
    },
    findings: orderedFindings
  };
}

function checkStaleFile(findings, name, file, staleHours) {
  if (!file || !fs.existsSync(file)) return;
  try {
    const stat = fs.statSync(file);
    const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
    if (ageHours > staleHours) {
      findings.push({
        severity: "warning",
        code: `${name}_stale`,
        message: `${name} has not changed for ${Math.floor(ageHours)} hours.`,
        modifiedAt: stat.mtime.toISOString()
      });
    }
  } catch (error) {
    findings.push({ severity: "warning", code: `${name}_stat_failed`, message: error instanceof Error ? error.message : String(error) });
  }
}




async function doctorFix(config, args = {}) {
  const fixes = [];
  const workspacePath = args.workspacePath ? existingDirectoryPath(args.workspacePath, "workspacePath") : "";
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

function assertJsonFileExtension(filePath, label) {
  if (path.extname(filePath).toLowerCase() !== ".json") {
    throw new Error(`${label} must point to a .json file: ${filePath}`);
  }
}

function canonicalBaseDir(baseDir) {
  const realBase = fs.realpathSync(baseDir);
  return realBase.endsWith(path.sep) ? realBase : realBase + path.sep;
}

function existingDirectoryPath(rawPath, label, baseDir = process.cwd()) {
  const base = canonicalBaseDir(baseDir);
  const relativePath = validateRelativePath(String(rawPath || ""));
  const candidate = path.join(base, relativePath);
  const realPath = fs.realpathSync(candidate);
  if (!realPath.startsWith(base)) throw new Error(`${label} escapes allowed directory: ${rawPath}`);
  if (!fs.statSync(realPath).isDirectory()) throw new Error(`${label} is not a directory: ${realPath}`);
  return realPath;
}

function relativeJsonPath(rawPath, label) {
  const relativePath = validateRelativePath(String(rawPath || ""));
  assertJsonFileExtension(relativePath, label);
  return relativePath;
}

function existingReadableJsonPath(rawPath, label, baseDir = process.cwd()) {
  const base = canonicalBaseDir(baseDir);
  const candidate = path.join(base, relativeJsonPath(rawPath, label));
  const realPath = fs.realpathSync(candidate);
  if (!realPath.startsWith(base)) throw new Error(`${label} escapes allowed directory: ${rawPath}`);
  if (!fs.statSync(realPath).isFile()) throw new Error(`${label} is not a file: ${realPath}`);
  return realPath;
}

function writableJsonPath(rawPath, label, baseDir = process.cwd()) {
  const base = canonicalBaseDir(baseDir);
  const relativePath = relativeJsonPath(rawPath, label);
  const target = path.join(base, relativePath);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const realParent = fs.realpathSync(parent);
  if (!realParent.startsWith(base)) throw new Error(`${label} escapes allowed directory: ${rawPath}`);
  return path.join(realParent, path.basename(relativePath));
}

function trustedDefaultConfigPath() {
  return path.join(os.homedir(), ".rel-ai", "opencode.json");
}

function importOriginalRelAiConfig(args = {}) {
  const sourcePath = args.sourcePath
    ? existingReadableJsonPath(args.sourcePath, "sourcePath")
    : trustedDefaultConfigPath();
  const source = safeReadJson(sourcePath);
  if (!source) throw new Error(`Original Rel.AI config file is corrupted or empty: ${sourcePath}`);
  const config = readConfig({ allowMissing: true });
  const imported = [];
  for (const [alias, entry] of Object.entries(source.workspaces || {})) {
    if (!entry?.path) continue;
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
  if (config.productUx?.enableStateExport === false) {
    throw new Error("State export is disabled (productUx.enableStateExport=false).");
  }
  const stateDir = getStateDir(config);
  const maxFiles = clampNumber(args.maxFiles || 2000, 1, 20000);
  const files = [];
  walkState(stateDir, stateDir, files, maxFiles, clampNumber(args.maxFileBytes || 1024 * 1024, 1000, 10 * 1024 * 1024));
  const payload = { version: 1, exportedAt: new Date().toISOString(), stateDir, files };
  if (args.outputPath) {
    const out = writableJsonPath(args.outputPath, "outputPath");
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
    const inputPath = existingReadableJsonPath(args.inputPath, "inputPath");
    payload = safeReadJson(inputPath);
    if (!payload) throw new Error(`State import file is corrupted or empty: ${inputPath}`);
  }
  if (!Array.isArray(payload?.files)) throw new Error("State import payload must contain a files array.");
  const stateDir = getStateDir(config);
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const stateBase = canonicalBaseDir(stateDir);
  const written = [];
  for (const item of payload.files) {
    if (!item?.path || typeof item.content !== "string") continue;
    const relative = validateRelativePath(String(item.path));
    const target = path.join(stateBase, relative);
    const parent = path.dirname(target);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const realParent = fs.realpathSync(parent);
    if (!realParent.startsWith(stateBase)) throw new Error(`Unsafe state path: ${relative}`);
    fs.writeFileSync(path.join(realParent, path.basename(relative)), item.content, { mode: 0o600 });
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
    try {
      scripts = safeReadJson(pkgPath)?.scripts || {};
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] package script discovery:', error);
    }
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


// Recursively find directories whose name matches `namePattern` and whose mtime is
// older than the cutoff (e.g. abandoned staged-edit payload dirs).

function walkState(root, current, files, maxFiles, maxFileBytes) {
  if (!fs.existsSync(current) || files.length >= maxFiles) return;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (files.length >= maxFiles) break;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) walkState(root, full, files, maxFiles, maxFileBytes);
    else {
      const stat = fs.statSync(full);
      if (stat.size > maxFileBytes) continue;
      const relative = path.relative(root, full).replaceAll(path.win32.sep, "/");
      files.push({ path: relative, modifiedAt: stat.mtime.toISOString(), content: fs.readFileSync(full, "utf8") });
    }
  }
}

function commandMapOrEmpty(value) {
  return Object(value) === value ? value : {};
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''), 'en-US', { numeric: true, sensitivity: 'base' });
}

function compareHealthFindings(left, right) {
  return healthSeverityRank(left?.severity) - healthSeverityRank(right?.severity)
    || compareText(left?.workspace, right?.workspace)
    || compareText(left?.code, right?.code);
}

function healthSeverityRank(value) {
  if (value === 'error') return 0;
  if (value === 'warning') return 1;
  return 2;
}

function auditTimestamp(entry) {
  const timestamp = Date.parse(entry?.ts || entry?.at || entry?.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function cautionSummary(config, options = {}) {
  const windowHours = clampNumber(options.windowHours || 24, 1, 720);
  const limit = clampNumber(options.limit || 200, 1, 2000);
  const cutoffMs = Date.now() - windowHours * 3600000;
  const sourceEntries = Array.isArray(options.entries)
    ? options.entries.slice(-limit)
    : readAudit(config, { limit }).entries;
  const entries = [...(sourceEntries || [])].sort((left, right) => auditTimestamp(right) - auditTimestamp(left));
  const byAlias = {};
  for (const e of entries || []) {
    if (e?.cautionLevel !== "caution") continue;
    const ts = Date.parse(e.ts || "");
    if (!Number.isFinite(ts) || ts < cutoffMs) continue;
    const alias = e.workspace || "__unknown__";
    if (!byAlias[alias]) byAlias[alias] = { alias, count: 0, recent: [] };
    byAlias[alias].count += 1;
    if (byAlias[alias].recent.length < 5) {
      byAlias[alias].recent.push({
        tool: e.tool,
        ts: e.ts || null,
        reason: e.cautionReason || null,
        taskId: e.taskId || null,
        path: e.filePath || e.path || null
      });
    }
  }
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    windowHours,
    workspaces: Object.values(byAlias).sort((left, right) => compareText(left.alias, right.alias))
  };
}

function aliasConsistencyCheck(config) {
  const results = [];
  const entries = Object.entries(config.workspaces || {}).sort(([left], [right]) => compareText(left, right));
  for (const [alias, ws] of entries) {
    // Cover BOTH command maps, matching relai_status. Checking only testCommands made
    // the dashboard report "All consistent" while relai_status flagged a stale entry in
    // the plain commands map — two surfaces disagreeing about the same workspace.
    const allConfigured = { ...commandMapOrEmpty(ws.commands), ...commandMapOrEmpty(ws.testCommands) };
    const configuredKeys = Object.keys(allConfigured).sort(compareText);
    let discovered = {};
    try { discovered = discoverCommands(ws.path || ''); } catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] alias command discovery:', error); }
    const discoveredKeys = Object.keys(discovered).sort(compareText);
    const staleKeys = staleCommandKeys(allConfigured, discovered).sort(compareText);
    results.push({ alias, configuredKeys, discoveredKeys, staleKeys, ok: staleKeys.length === 0 });
  }
  return { ok: results.every(r => r.ok), generatedAt: new Date().toISOString(), workspaces: results };
}

export { dashboardData, liveLogTail, healthMonitor, aliasConsistencyCheck, cautionSummary,   doctorFix, setupWizard, importOriginalRelAiConfig, stateExport, stateImport };
