const fs = require("node:fs");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("../process");
const { resolveSafePath } = require("../safety");

const AGGRESSIVE_ARCHIVE_EXCLUDED_NAMES = new Set([".git", "node_modules", "build", "dist", "coverage", ".dart_tool", ".gradle", ".relai", ".rel-ai-mcp", ".venv", "venv", "target", "obj", "Pods"]);
const AGGRESSIVE_ARCHIVE_EXCLUDED_PATHS = [".git/", "node_modules/", "build/", "dist/", "coverage/", ".dart_tool/", ".gradle/", ".relai/", ".rel-ai-mcp/"];

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function resolveHostPath(value) {
  if (!value) return "";
  let text = String(value).trim();
  if (text === "~") text = require("node:os").homedir();
  else if (text.startsWith("~/") || text.startsWith("~\\")) text = path.join(require("node:os").homedir(), text.slice(2));
  return path.resolve(text);
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildZipCommand(platform, sourceDir, archivePath) {
  if (platform === "win32") {
    return {
      exe: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `Compress-Archive -Path ${quotePowerShell(path.join(sourceDir, "*"))} -DestinationPath ${quotePowerShell(archivePath)} -Force`]
    };
  }
  return { exe: "zip", args: ["-qr", archivePath, "."], cwd: sourceDir };
}

function buildUnzipCommand(platform, archivePath, destination) {
  if (platform === "win32") {
    return {
      exe: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(destination)} -Force`]
    };
  }
  return { exe: "unzip", args: ["-q", archivePath, "-d", destination] };
}

async function extractZipArchive(archivePath, destination, config, args) {
  const timeout = clampNumber(args.timeoutMs, 1000, 86400000, 120000);
  const cmd = buildUnzipCommand(process.platform, archivePath, destination);
  const result = await runProcess(cmd.exe, cmd.args, { cwd: cmd.cwd || destination, timeout }, config);
  return { ok: result.exitCode === 0, ...summarizeCommand(result) };
}

async function createZipArchive(sourceDir, archivePath, config, args) {
  const timeout = clampNumber(args.timeoutMs, 1000, 86400000, 120000);
  fs.mkdirSync(path.dirname(archivePath), { recursive: true, mode: 0o700 });
  const cmd = buildZipCommand(process.platform, sourceDir, archivePath);
  const result = await runProcess(cmd.exe, cmd.args, { cwd: cmd.cwd || sourceDir, timeout }, config);
  return { ok: result.exitCode === 0, ...summarizeCommand(result) };
}

function detectArchiveOverlayRoot(extractedRoot) {
  const entries = fs.readdirSync(extractedRoot, { withFileTypes: true }).filter((entry) => entry.name !== "__MACOSX");
  const dirs = entries.filter((entry) => entry.isDirectory());
  const files = entries.filter((entry) => entry.isFile());
  if (dirs.length === 1 && files.length === 0) return path.join(extractedRoot, dirs[0].name);
  return extractedRoot;
}

function previewArchiveOverlay(workspaceRoot, sourceRoot, options = {}) {
  const wouldCopy = [];
  const wouldClear = [];
  const skipped = [];
  const errors = [];
  const sourceFiles = new Set();
  walkArchiveSource(sourceRoot, "", (absoluteSource, relativePath, stat) => {
    sourceFiles.add(relativePath);
    try {
      const safe = resolveSafePath(workspaceRoot, relativePath);
      wouldCopy.push({ path: safe.relativePath, bytes: stat.size });
    } catch (error) {
      errors.push({ path: relativePath, error: error instanceof Error ? error.message : String(error) });
    }
  }, skipped);
  if (options.clearMissing) {
    walkArchiveTarget(workspaceRoot, "", (_absoluteTarget, relativePath) => {
      if (sourceFiles.has(relativePath)) return;
      try {
        const safe = resolveSafePath(workspaceRoot, relativePath);
        wouldClear.push(safe.relativePath);
      } catch (error) {
        errors.push({ path: relativePath, error: error instanceof Error ? error.message : String(error) });
      }
    }, skipped);
  }
  return { wouldCopy, wouldClear, skipped, errors };
}

function overlayDirectory(workspaceRoot, sourceRoot, options = {}) {
  const copied = [];
  const cleared = [];
  const skipped = [];
  const errors = [];
  const sourceFiles = new Set();
  walkArchiveSource(sourceRoot, "", (absoluteSource, relativePath, stat) => {
    sourceFiles.add(relativePath);
    try {
      const safe = resolveSafePath(workspaceRoot, relativePath);
      fs.mkdirSync(path.dirname(safe.absolutePath), { recursive: true });
      fs.copyFileSync(absoluteSource, safe.absolutePath);
      copied.push({ path: safe.relativePath, bytes: stat.size });
    } catch (error) {
      errors.push({ path: relativePath, error: error instanceof Error ? error.message : String(error) });
    }
  }, skipped);

  if (options.clearMissing) {
    walkArchiveTarget(workspaceRoot, "", (absoluteTarget, relativePath) => {
      if (sourceFiles.has(relativePath)) return;
      try {
        const safe = resolveSafePath(workspaceRoot, relativePath);
        fs.rmSync(safe.absolutePath, { force: true });
        cleared.push(safe.relativePath);
      } catch (error) {
        errors.push({ path: relativePath, error: error instanceof Error ? error.message : String(error) });
      }
    }, skipped);
  }

  return { copied, cleared, skipped, errors, changedFiles: [...new Set([...copied.map((item) => item.path), ...cleared])] };
}

function walkArchiveSource(root, prefix, onFile, skipped) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true }); } catch (error) { skipped.push({ path: prefix || ".", reason: error.message }); return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (shouldSkipArchivePath(rel, entry)) { skipped.push({ path: rel, reason: "excluded archive path" }); continue; }
    const abs = path.join(root, rel);
    if (entry.isSymbolicLink()) { skipped.push({ path: rel, reason: "symlink skipped" }); continue; }
    if (entry.isDirectory()) { walkArchiveSource(root, rel, onFile, skipped); continue; }
    if (!entry.isFile()) continue;
    onFile(abs, rel, fs.statSync(abs));
  }
}

function walkArchiveTarget(root, prefix, onFile, skipped) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true }); } catch (error) { skipped.push({ path: prefix || ".", reason: error.message }); return; }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (shouldSkipArchivePath(rel, entry)) continue;
    const abs = path.join(root, rel);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { walkArchiveTarget(root, rel, onFile, skipped); continue; }
    if (entry.isFile()) onFile(abs, rel);
  }
}

function shouldSkipArchivePath(relativePath, entry) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("/../") || normalized.startsWith("../")) return true;
  if (AGGRESSIVE_ARCHIVE_EXCLUDED_NAMES.has(entry.name) || AGGRESSIVE_ARCHIVE_EXCLUDED_NAMES.has(normalized)) return true;
  for (const pattern of AGGRESSIVE_ARCHIVE_EXCLUDED_PATHS) {
    if (normalized === pattern.replace(/\/$/, "") || normalized.startsWith(pattern)) return true;
  }
  // Skip any .env* files (e.g. .env, .env.local, .env.production, .env-staging)
  if (/^\.env($|[./-])/i.test(entry.name)) return true;
  return false;
}

function copyWorkspaceForArchive(sourceRoot, destinationRoot, options = {}) {
  const files = [];
  const skipped = [];
  const maxFiles = options.maxFiles || 50000;
  walkArchiveSource(sourceRoot, "", (absoluteSource, relativePath, stat) => {
    if (files.length >= maxFiles) { skipped.push({ path: relativePath, reason: "maxFiles reached" }); return; }
    const out = path.join(destinationRoot, relativePath);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(absoluteSource, out);
    files.push({ path: relativePath, bytes: stat.size });
  }, skipped);
  return { files, skipped, truncated: files.length >= maxFiles };
}

module.exports = {
  AGGRESSIVE_ARCHIVE_EXCLUDED_NAMES,
  AGGRESSIVE_ARCHIVE_EXCLUDED_PATHS,
  resolveHostPath,
  buildZipCommand,
  buildUnzipCommand,
  extractZipArchive,
  createZipArchive,
  detectArchiveOverlayRoot,
  previewArchiveOverlay,
  overlayDirectory,
  walkArchiveSource,
  walkArchiveTarget,
  shouldSkipArchivePath,
  copyWorkspaceForArchive
};
