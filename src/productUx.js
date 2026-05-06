const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { publicConfigSummary, resolveWorkspace, writeConfig, readConfig, getConfigPath, makeDefaultConfig } = require("./config");
const { readAudit, getStateDir } = require("./audit");
const sessions = require("./sessions");
const { listJobs } = require("./jobs");
const approvals = require("./approvals");
const locks = require("./locks");
const multiagent = require("./multiagent");
const { listWorktrees } = require("./worktrees");
const { runProcess, summarizeCommand } = require("./process");
const { safeReadJson } = require("./safety");

function dashboardData(config, args = {}) {
  const limit = clampNumber(args.limit || 100, 1, 500);
  const sessionItems = sessions.listSessions(config, { limit });
  const jobItems = listJobs(config, { limit });
  const approvalItems = approvals.listApprovals(config, { limit });
  const lockItems = locks.listLocks(config).locks || [];
  const auditTail = readAudit(config, { limit: Math.min(limit, 200) });
  const health = healthMonitor(config, { limit: 25 });
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    config: publicConfigSummary(config),
    counts: {
      sessions: sessionItems.length,
      jobs: jobItems.length,
      approvals: approvalItems.length,
      locks: lockItems.length,
      auditEntries: auditTail.entries ? auditTail.entries.length : 0
    },
    sessions: sessionItems,
    jobs: jobItems,
    approvals: approvalItems,
    locks: lockItems,
    multiAgent: multiagent.multiagentStatus(config, { limit }),
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

function healthMonitor(config, args = {}) {
  const findings = [];
  const stateDir = getStateDir(config);
  checkDir(findings, "stateDir", stateDir, true);
  checkDir(findings, "worktreeRoot", config.worktreeRoot, true);
  checkFile(findings, "config", getConfigPath(), false);

  const sessionItems = sessions.listSessions(config, { limit: args.limit || 200 });
  const jobItems = listJobs(config, { limit: args.limit || 200 });
  const approvalItems = approvals.listApprovals(config, { limit: args.limit || 200 });
  const lockItems = locks.listLocks(config).locks || [];
  const staleHours = Number(config.productUx && config.productUx.staleHours || 24);
  const staleSessions = sessionItems.filter((item) => isOlderThan(item.updatedAt || item.createdAt, staleHours));
  const staleJobs = jobItems.filter((item) => ["running", "cancelling"].includes(item.status) && isOlderThan(item.updatedAt || item.startedAt, staleHours));
  const staleLocks = lockItems.filter((item) => isOlderThan(item.updatedAt || item.createdAt, staleHours));

  if (staleSessions.length) findings.push({ severity: "info", code: "stale_sessions", message: `${staleSessions.length} session(s) older than ${staleHours}h.`, items: staleSessions.slice(0, 20) });
  if (staleJobs.length) findings.push({ severity: "warning", code: "stale_jobs", message: `${staleJobs.length} running/cancelling job(s) look stale.`, items: staleJobs.slice(0, 20) });
  if (staleLocks.length) findings.push({ severity: "warning", code: "stale_locks", message: `${staleLocks.length} lock(s) look stale.`, items: staleLocks.slice(0, 20) });
  if (approvalItems.length > 25) findings.push({ severity: "info", code: "many_approvals", message: `${approvalItems.length} approval records exist; cleanup may be useful.` });

  const workspaces = Object.keys(config.workspaces || {}).map((alias) => {
    try {
      const workspace = resolveWorkspace(config, alias);
      const wt = listWorktrees(workspace);
      return { alias, ok: true, path: workspace.path, worktreeCount: Array.isArray(wt.worktrees) ? wt.worktrees.length : 0 };
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
      sessions: sessionItems.length,
      jobs: jobItems.length,
      approvals: approvalItems.length,
      locks: lockItems.length,
      findings: findings.length
    },
    findings
  };
}

function cleanupPreview(config, args = {}) {
  return cleanupPlan(config, args, false);
}

function cleanupRun(config, args = {}) {
  if (args.confirm !== true) throw new Error("cleanupRun requires confirm=true.");
  return cleanupPlan(config, args, true);
}

function cleanupPlan(config, args = {}, apply) {
  const stateDir = getStateDir(config);
  const olderThanHours = clampNumber(args.olderThanHours || (config.productUx && config.productUx.cleanupOlderThanHours) || 168, 1, 24 * 365);
  const includeAudit = args.includeAudit === true;
  const targets = [];
  collectOldJson(targets, path.join(stateDir, "jobs"), olderThanHours, [".json", ".log"]);
  collectOldJson(targets, path.join(stateDir, "snapshots"), olderThanHours, [".json"]);
  collectOldJson(targets, path.join(stateDir, "approvals"), olderThanHours, [".json"]);
  if (includeAudit) collectOldJson(targets, path.dirname(config.auditLogPath), olderThanHours, [path.basename(config.auditLogPath)]);
  const limited = targets.slice(0, clampNumber(args.maxDeletes || 500, 1, 5000));
  const deleted = [];
  if (apply) {
    for (const file of limited) {
      try {
        fs.rmSync(file.path, { force: true });
        deleted.push(file);
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
    deleted,
    message: apply ? `Deleted ${deleted.length} file(s).` : "Preview only. Re-run with confirm=true to delete candidates."
  };
}

async function doctorFix(config, args = {}) {
  const fixes = [];
  const workspacePath = args.workspacePath ? path.resolve(String(args.workspacePath)) : "";
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
      const result = await runProcess("git", ["add", "--renormalize", "."], { cwd: workspacePath, shell: false }, config);
      fixes.push({ action: "git add --renormalize .", result: summarizeCommand(result) });
    }
  }
  fs.mkdirSync(getStateDir(config), { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.worktreeRoot, { recursive: true, mode: 0o700 });
  fixes.push({ path: getStateDir(config), action: "ensured stateDir" });
  fixes.push({ path: config.worktreeRoot, action: "ensured worktreeRoot" });
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
  return {
    ok: true,
    configPath: getConfigPath(),
    suggestedToken: token,
    config,
    nextCommands: [
      "npm run init-config",
      workspacePath ? `npm run workspace:add -- ${alias} ${workspacePath}` : "npm run workspace:add -- myapp /absolute/path/to/project",
      token ? `REL_AI_MCP_TOKEN=${token} npm run start:http -- --host 127.0.0.1 --port 3333` : "npm run start:http -- --host 127.0.0.1 --port 3333"
    ]
  };
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
    const relative = String(item.path).replace(/\\/g, "/");
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
  if (fs.existsSync(path.join(workspacePath, "package.json"))) {
    out.test = "npm test";
    out.lint = "npm run lint";
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
      if (Date.now() - stat.mtimeMs > olderThanHours * 3600000) targets.push({ path: full, size: stat.size, modifiedAt: stat.mtime.toISOString() });
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
      const relative = path.relative(root, full).replace(/\\/g, "/");
      files.push({ path: relative, modifiedAt: stat.mtime.toISOString(), content: fs.readFileSync(full, "utf8") });
    }
  }
}

function isOlderThan(iso, hours) {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return false;
  return Date.now() - time > hours * 3600000;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

module.exports = {
  dashboardData,
  liveLogTail,
  healthMonitor,
  cleanupPreview,
  cleanupRun,
  doctorFix,
  setupWizard,
  importOriginalRelAiConfig,
  stateExport,
  stateImport
};
