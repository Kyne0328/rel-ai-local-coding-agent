const fs = require("node:fs");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("./process");
const {
  collectTextFiles,
  readTextFileSafe,
  writeTextFileSafe,
  resolveSafePath,
  fileSha256,
  looksBinary
} = require("./safety");
const { discoverCommands } = require("./commandDiscovery");

const DEFAULT_MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_FILES = 1000;
const DEFAULT_MAX_DIFF_BYTES = 300000;

function repoSnapshot(workspace, config, args = {}) {
  const maxEntries = clampNumber(args.maxEntries, 1, 20000, DEFAULT_MAX_SNAPSHOT_FILES);
  const includeFiles = args.includeFiles !== false;
  const tree = collectTextFiles(workspace.path, { maxEntries });
  const manifests = readManifests(workspace.path);
  const discoveredCommands = discoverCommands(workspace.path);
  return {
    ok: true,
    workspace: workspace.alias,
    root: workspace.path,
    toolMode: config.toolMode || "chatgpt_local_repo",
    trustedLocalAgent: Boolean(config.trustedLocalAgent),
    manifests: Object.keys(manifests),
    manifestContents: manifests,
    discoveredCommands,
    fileCount: tree.files.length,
    ...(includeFiles ? { files: tree.files } : {}),
    skipped: tree.skipped.slice(0, 200),
    truncated: tree.truncated,
    hints: projectHints(Object.keys(manifests)),
    recommendedFlow: ["relai_read", "relai_write", "relai_shell or relai_verify", "relai_diff"]
  };
}

function relaiRead(workspace, args = {}) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) throw new Error("paths must contain at least one path.");
  const maxBytes = clampNumber(args.maxBytes, 1000, 10 * 1024 * 1024, DEFAULT_MAX_READ_BYTES);
  const items = [];
  const skipped = [];
  for (const requested of paths) {
    try {
      const safe = resolveSafePath(workspace.path, requested);
      const stat = fs.statSync(safe.absolutePath);
      if (stat.isDirectory()) {
        items.push(readDirectory(workspace.path, safe.relativePath, args));
        continue;
      }
      if (!stat.isFile()) {
        skipped.push({ path: String(requested), reason: "not a file or directory" });
        continue;
      }
      const data = fs.readFileSync(safe.absolutePath);
      if (looksBinary(data)) {
        skipped.push({ path: safe.relativePath, reason: "binary-looking file" });
        continue;
      }
      const text = data.toString("utf8");
      const truncated = Buffer.byteLength(text, "utf8") > maxBytes;
      items.push({
        type: "file",
        path: safe.relativePath,
        sha256: fileSha256(workspace.path, safe.relativePath),
        bytes: data.length,
        truncated,
        content: truncated ? text.slice(0, maxBytes) : text
      });
    } catch (error) {
      skipped.push({ path: String(requested), reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: true, workspace: workspace.alias, items, skipped };
}

function relaiWrite(workspace, args = {}) {
  const edits = Array.isArray(args.edits) ? args.edits : [];
  if (edits.length === 0) throw new Error("edits must contain at least one edit.");
  const dryRun = Boolean(args.dryRun);
  const results = [];
  for (let i = 0; i < edits.length; i += 1) {
    results.push(applyWriteEdit(workspace, edits[i] || {}, i, { dryRun }));
  }
  return {
    ok: results.every((item) => item.ok !== false),
    dryRun,
    workspace: workspace.alias,
    changedFiles: results.filter((item) => item.changed).map((item) => item.path),
    results
  };
}

async function relaiVerify(workspace, config, args = {}) {
  const level = String(args.level || "standard").toLowerCase();
  const commands = Array.isArray(args.commands) && args.commands.length
    ? args.commands.map(String)
    : detectVerifyCommands(workspace.path, level);
  if (commands.length === 0) return { ok: true, workspace: workspace.alias, level, commands: [], results: [], message: "No verification commands detected." };
  const stopOnFailure = args.stopOnFailure !== false;
  const results = [];
  for (const command of commands) {
    const result = await runProcess(command, [], {
      cwd: workspace.path,
      shell: true,
      commandString: command,
      timeout: clampNumber(args.timeoutMs, 1000, 30 * 60 * 1000, 120000)
    }, config);
    const summary = { command, ...summarizeCommand(result) };
    results.push(summary);
    if (!summary.ok && stopOnFailure) break;
  }
  return { ok: results.every((item) => item.ok), workspace: workspace.alias, level, commands, results };
}

async function relaiBrowser(workspace, config, args = {}) {
  const url = String(args.url || args.route || "").trim();
  const command = String(args.command || "").trim();
  if (command) {
    const result = await runProcess(command, [], {
      cwd: workspace.path,
      shell: true,
      commandString: command,
      timeout: clampNumber(args.timeoutMs, 1000, 30 * 60 * 1000, 120000)
    }, config);
    return { ok: result.exitCode === 0, workspace: workspace.alias, mode: "command", command, ...summarizeCommand(result) };
  }
  if (!url) throw new Error("url, route, or command is required.");
  const script = `
    const target = ${JSON.stringify(url)};
    fetch(target).then(async (res) => {
      const text = await res.text();
      console.log(JSON.stringify({ ok: res.ok, status: res.status, url: res.url, bytes: text.length, title: ((text.match(/<title[^>]*>([^<]*)<\\/title>/i)||[])[1] || '') }));
      process.exit(res.ok ? 0 : 1);
    }).catch((err) => { console.error(err && err.message || String(err)); process.exit(1); });
  `;
  const result = await runProcess(process.execPath, ["-e", script], { cwd: workspace.path, timeout: clampNumber(args.timeoutMs, 1000, 600000, 30000) }, config);
  return { ok: result.exitCode === 0, workspace: workspace.alias, mode: "http", url, ...summarizeCommand(result) };
}

async function relaiDiff(workspace, config, args = {}) {
  const staged = Boolean(args.staged);
  const stat = await runProcess("git", ["status", "--short"], { cwd: workspace.path, timeout: 30000 }, config);
  const diffArgs = ["diff", ...(staged ? ["--staged"] : [])];
  if (args.path) diffArgs.push("--", resolveSafePath(workspace.path, args.path).relativePath);
  const diff = await runProcess("git", diffArgs, { cwd: workspace.path, timeout: 60000 }, config);
  const maxBytes = clampNumber(args.maxBytes, 1000, 5 * 1024 * 1024, DEFAULT_MAX_DIFF_BYTES);
  const diffText = diff.stdout || "";
  return {
    ok: stat.exitCode === 0 && diff.exitCode === 0,
    workspace: workspace.alias,
    staged,
    status: stat.stdout || "",
    diff: Buffer.byteLength(diffText, "utf8") > maxBytes ? diffText.slice(0, maxBytes) + `\n[rel-ai-mcp diff truncated at ${maxBytes} bytes]` : diffText,
    exitCode: diff.exitCode,
    ...(diff.stderr ? { stderr: diff.stderr } : {})
  };
}

async function relaiReset(workspace, config, args = {}) {
  const mode = String(args.mode || "paths").toLowerCase();
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length > 0) {
    const safePaths = paths.map((p) => resolveSafePath(workspace.path, p).relativePath);
    const restore = await runProcess("git", ["restore", "--", ...safePaths], { cwd: workspace.path, timeout: 60000 }, config);
    return { ok: restore.exitCode === 0, workspace: workspace.alias, mode: "paths", paths: safePaths, ...summarizeCommand(restore) };
  }
  if (mode !== "hard") throw new Error("relai_reset requires paths, or mode='hard'.");
  const reset = await runProcess("git", ["reset", "--hard"], { cwd: workspace.path, timeout: 60000 }, config);
  let clean = null;
  if (args.clean) clean = await runProcess("git", ["clean", "-fd"], { cwd: workspace.path, timeout: 60000 }, config);
  return { ok: reset.exitCode === 0 && (!clean || clean.exitCode === 0), workspace: workspace.alias, mode: "hard", reset: summarizeCommand(reset), ...(clean ? { clean: summarizeCommand(clean) } : {}) };
}

function applyWriteEdit(workspace, edit, index, options) {
  const op = normalizeOp(edit.op || edit.type);
  const relativePath = String(edit.file || edit.path || "").trim();
  if (!relativePath) throw new Error(`edits[${index}].file is required.`);
  const safe = resolveSafePath(workspace.path, relativePath);
  const exists = fs.existsSync(safe.absolutePath);
  const oldContent = exists ? readTextFileSafe(workspace.path, safe.relativePath) : "";
  const oldSha256 = exists ? fileSha256(workspace.path, safe.relativePath) : null;
  if (edit.expectedSha256 && edit.expectedSha256 !== oldSha256) {
    throw new Error(`SHA mismatch for ${safe.relativePath}. Expected ${edit.expectedSha256}, got ${oldSha256 || "missing"}.`);
  }
  const newContent = transformContent(oldContent, edit, op, index);
  const changed = newContent !== oldContent;
  if (!changed) return { ok: true, path: safe.relativePath, op, changed: false, oldSha256, newSha256: oldSha256 };
  if (options.dryRun) return { ok: true, path: safe.relativePath, op, changed: true, dryRun: true, oldSha256, newSha256: sha256Text(newContent) };
  const write = writeTextFileSafe(workspace.path, safe.relativePath, newContent, { expectedSha256: oldSha256 || undefined });
  return { ok: true, path: safe.relativePath, op, changed: true, oldSha256, newSha256: write.sha256, bytes: write.bytes };
}

function transformContent(content, edit, op, index) {
  switch (op) {
    case "writeFile":
      return String(edit.content ?? edit.text ?? "");
    case "replaceExact":
      return replaceExact(content, required(edit.old ?? edit.text, index, "old"), String(edit.new ?? ""), edit, false);
    case "replaceFirst":
      return replaceExact(content, required(edit.old ?? edit.text, index, "old"), String(edit.new ?? ""), { ...edit, occurrence: 1 }, false);
    case "replaceAll":
      return replaceExact(content, required(edit.old ?? edit.text, index, "old"), String(edit.new ?? ""), edit, true);
    case "insertBefore":
      return insertRelative(content, required(edit.anchor, index, "anchor"), required(edit.text ?? edit.new, index, "text"), edit, "before");
    case "insertAfter":
      return insertRelative(content, required(edit.anchor, index, "anchor"), required(edit.text ?? edit.new, index, "text"), edit, "after");
    case "replaceBetween":
      return replaceBetween(content, required(edit.start, index, "start"), required(edit.end, index, "end"), String(edit.new ?? edit.text ?? ""), edit, false);
    case "deleteBetween":
      return replaceBetween(content, required(edit.start, index, "start"), required(edit.end, index, "end"), "", edit, true);
    case "replaceFunction":
      return replaceFunction(content, required(edit.functionName || edit.name, index, "functionName"), required(edit.text ?? edit.new, index, "text"));
    default:
      throw new Error(`Unsupported relai_write operation at edits[${index}]: ${op}`);
  }
}

function replaceExact(content, oldText, newText, edit, replaceAll) {
  const matches = findAll(content, oldText);
  if (matches.length === 0) throw new Error("replace operation found no matches.");
  if (replaceAll || edit.count === "all") return content.split(oldText).join(newText);
  const occurrence = edit.occurrence == null ? null : Number(edit.occurrence);
  if (occurrence != null) {
    if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > matches.length) throw new Error(`Invalid occurrence ${edit.occurrence}; found ${matches.length} match(es).`);
    const pos = matches[occurrence - 1];
    return content.slice(0, pos) + newText + content.slice(pos + oldText.length);
  }
  if (matches.length !== 1) throw new Error(`replace operation is ambiguous: found ${matches.length} matches. Use occurrence or replaceAll.`);
  const pos = matches[0];
  return content.slice(0, pos) + newText + content.slice(pos + oldText.length);
}

function insertRelative(content, anchor, text, edit, where) {
  const matches = findAll(content, anchor);
  if (matches.length === 0) throw new Error(`insert_${where} found no anchor matches.`);
  const occurrence = edit.occurrence == null ? 1 : Number(edit.occurrence);
  if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > matches.length) throw new Error(`Invalid occurrence ${edit.occurrence || 1}; found ${matches.length} anchor match(es).`);
  const base = matches[occurrence - 1];
  const pos = where === "before" ? base : base + anchor.length;
  return content.slice(0, pos) + text + content.slice(pos);
}

function replaceBetween(content, start, end, text, edit, deleteMarkers) {
  const startMatches = findAll(content, start);
  if (startMatches.length === 0) throw new Error("replaceBetween found no start marker.");
  const occurrence = edit.occurrence == null ? 1 : Number(edit.occurrence);
  if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > startMatches.length) throw new Error(`Invalid occurrence ${edit.occurrence || 1}; found ${startMatches.length} start marker match(es).`);
  const startPos = startMatches[occurrence - 1];
  const endPos = content.indexOf(end, startPos + start.length);
  if (endPos === -1) throw new Error("replaceBetween found no end marker after selected start marker.");
  const from = deleteMarkers ? startPos : startPos + start.length;
  const to = deleteMarkers ? endPos + end.length : endPos;
  return content.slice(0, from) + text + content.slice(to);
}

function replaceFunction(content, functionName, text) {
  const escaped = escapeRegExp(functionName);
  const patterns = [
    new RegExp(`async\\s+function\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`function\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`const\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{`)
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (!match) continue;
    const start = match.index;
    const open = content.indexOf("{", start);
    const end = findMatchingBrace(content, open);
    if (end === -1) throw new Error(`Could not find end of function ${functionName}.`);
    return content.slice(0, start) + text + content.slice(end + 1);
  }
  throw new Error(`Function not found: ${functionName}`);
}

function readDirectory(root, relativePath, args) {
  const maxEntries = clampNumber(args.maxEntries, 1, 20000, 1000);
  const prefix = relativePath === "." ? "" : relativePath;
  const result = collectTextFiles(path.join(root, prefix), { maxEntries });
  return {
    type: "directory",
    path: relativePath,
    fileCount: result.files.length,
    files: result.files.map((item) => prefix ? `${prefix}/${item}` : item),
    skipped: result.skipped,
    truncated: result.truncated
  };
}

function readManifests(root) {
  const names = ["package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "pubspec.yaml", "Makefile"];
  const out = {};
  for (const name of names) {
    const abs = path.join(root, name);
    if (!fs.existsSync(abs)) continue;
    try {
      const text = fs.readFileSync(abs, "utf8");
      out[name] = text.slice(0, 20000);
    } catch (_error) {}
  }
  return out;
}

function projectHints(manifests) {
  const hints = [];
  if (manifests.includes("package.json")) hints.push("Node/JavaScript/TypeScript project");
  if (manifests.includes("pyproject.toml") || manifests.includes("requirements.txt")) hints.push("Python project");
  if (manifests.includes("Cargo.toml")) hints.push("Rust project");
  if (manifests.includes("go.mod")) hints.push("Go project");
  if (manifests.includes("pubspec.yaml")) hints.push("Flutter/Dart project");
  return hints;
}

function detectVerifyCommands(root, level) {
  const commands = [];
  const packageJson = path.join(root, "package.json");
  if (fs.existsSync(packageJson)) {
    commands.push("node --check src/tools.js");
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8"));
      const scripts = pkg.scripts || {};
      if (scripts.check) commands.push("npm run check");
      if (level !== "quick" && scripts.test) commands.push("npm test");
      if (level === "full" && scripts.build) commands.push("npm run build");
    } catch (_error) {}
  }
  if (fs.existsSync(path.join(root, "pyproject.toml")) || fs.existsSync(path.join(root, "requirements.txt"))) commands.push("python -m pytest");
  if (fs.existsSync(path.join(root, "go.mod"))) commands.push("go test ./...");
  if (fs.existsSync(path.join(root, "Cargo.toml"))) commands.push("cargo test");
  return [...new Set(commands)];
}

function normalizeOp(op) {
  const raw = String(op || "").trim();
  const map = {
    write_file: "writeFile",
    replace_exact: "replaceExact",
    replace_first: "replaceFirst",
    replace_all: "replaceAll",
    insert_before: "insertBefore",
    insert_after: "insertAfter",
    replace_between: "replaceBetween",
    delete_between: "deleteBetween",
    replace_function: "replaceFunction"
  };
  return map[raw] || raw;
}

function required(value, index, key) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`edits[${index}].${key} must be a non-empty string.`);
  return value;
}

function findAll(content, needle) {
  if (!needle) throw new Error("Search text cannot be empty.");
  const positions = [];
  let offset = 0;
  while (offset <= content.length) {
    const found = content.indexOf(needle, offset);
    if (found === -1) break;
    positions.push(found);
    offset = found + Math.max(needle.length, 1);
  }
  return positions;
}

function findMatchingBrace(content, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openIndex; i < content.length; i += 1) {
    const ch = content[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sha256Text(text) {
  return require("node:crypto").createHash("sha256").update(String(text), "utf8").digest("hex");
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

module.exports = {
  repoSnapshot,
  relaiRead,
  relaiWrite,
  relaiVerify,
  relaiBrowser,
  relaiDiff,
  relaiReset
};
