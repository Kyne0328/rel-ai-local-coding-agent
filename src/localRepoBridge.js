const fs = require("node:fs");
const path = require("node:path");
const { runProcess, summarizeCommand } = require("./process");
const {
  collectTextFiles,
  collectOptionsFromWorkspace,
  writeTextFileSafe,
  resolveSafePath,
  fileSha256,
  looksBinary
} = require("./safety");
const { discoverCommands } = require("./commandDiscovery");
const { appendOperation, makeOperationId, summarizeOperations } = require("./journal");

const DEFAULT_MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_FILES = 1000;
const DEFAULT_MAX_DIFF_BYTES = 300000;

function repoSnapshot(workspace, config, args = {}) {
  const maxEntries = clampNumber(args.maxEntries, 1, 20000, DEFAULT_MAX_SNAPSHOT_FILES);
  const includeFiles = args.includeFiles !== false;
  const tree = collectTextFiles(workspace.path, collectOptionsFromWorkspace(workspace, { maxEntries }));
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
    recommendedFlow: ["relai_read", "relai_write", "relai_verify", "relai_diff", "relai_reset"],
    operationJournal: summarizeOperations(config, workspace, args.journalLimit || 10)
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
        items.push(readDirectory(workspace, safe.relativePath, args));
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

function relaiWrite(workspace, config, args = {}) {
  if (Array.isArray(args.edits) || args.find || args.replace || args.type || args.op || args.expectedSha256) {
    throw new Error("relai_write only supports full-file writes. Use direct mode { workspace, path, content } or staged mode { workspace, stage: 'start'|'append'|'commit'|'abort', ... }. Edit arrays, find/replace operations, patch scripts, and expectedSha256 are not supported in the bridge workflow.");
  }

  const stage = String(args.stage || "direct").trim().toLowerCase();
  if (stage === "direct" || stage === "") {
    const relativePath = String(args.path || "").trim();
    if (!relativePath) throw new Error("relai_write requires path and content. Expected: { workspace, path, content }.");
    if (typeof args.content !== "string") throw new Error("relai_write requires content as a string containing the entire target file. Expected: { workspace, path, content }.");
    return performFullFileWrite(workspace, config, relativePath, args.content, { dryRun: Boolean(args.dryRun) });
  }

  if (stage === "start") {
    const relativePath = String(args.path || "").trim();
    if (!relativePath) throw new Error("relai_write stage='start' requires path and content.");
    if (typeof args.content !== "string") throw new Error("relai_write stage='start' requires a content chunk string.");
    const safe = resolveSafePath(workspace.path, relativePath);
    const writeId = makeOperationId();
    writeStagedPayload(config, workspace, writeId, {
      id: writeId,
      workspace: workspace.alias,
      root: workspace.path,
      path: safe.relativePath,
      chunks: [args.content],
      bytes: Buffer.byteLength(args.content, "utf8"),
      createdAt: new Date().toISOString()
    });
    return {
      ok: true,
      workspace: workspace.alias,
      path: safe.relativePath,
      operation: "stagedFullFileWrite:start",
      writeId,
      chunks: 1,
      bytes: Buffer.byteLength(args.content, "utf8"),
      next: "Call relai_write with { workspace, stage: 'append', writeId, content } for more chunks, then { workspace, stage: 'commit', writeId } to write the complete file."
    };
  }

  if (stage === "append") {
    const writeId = validateWriteId(args.writeId);
    if (typeof args.content !== "string") throw new Error("relai_write stage='append' requires writeId and a content chunk string.");
    const payload = readStagedPayload(config, workspace, writeId);
    payload.chunks.push(args.content);
    payload.bytes += Buffer.byteLength(args.content, "utf8");
    payload.updatedAt = new Date().toISOString();
    writeStagedPayload(config, workspace, writeId, payload);
    return {
      ok: true,
      workspace: workspace.alias,
      path: payload.path,
      operation: "stagedFullFileWrite:append",
      writeId,
      chunks: payload.chunks.length,
      bytes: payload.bytes,
      next: "Append more chunks or call relai_write with { workspace, stage: 'commit', writeId }."
    };
  }

  if (stage === "commit") {
    const writeId = validateWriteId(args.writeId);
    const payload = readStagedPayload(config, workspace, writeId);
    const content = payload.chunks.join("");
    const result = performFullFileWrite(workspace, config, payload.path, content, { dryRun: Boolean(args.dryRun), staged: true, writeId });
    if (!args.dryRun) deleteStagedPayload(config, workspace, writeId);
    return {
      ...result,
      operation: "stagedFullFileWrite:commit",
      writeId,
      staged: true,
      chunks: payload.chunks.length,
      bytes: Buffer.byteLength(content, "utf8")
    };
  }

  if (stage === "abort") {
    const writeId = validateWriteId(args.writeId);
    const existed = deleteStagedPayload(config, workspace, writeId);
    return { ok: true, workspace: workspace.alias, operation: "stagedFullFileWrite:abort", writeId, deleted: existed };
  }

  throw new Error("relai_write stage must be one of: direct, start, append, commit, abort.");
}

function performFullFileWrite(workspace, config, relativePath, content, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const operationId = options.writeId || makeOperationId();
  const safe = resolveSafePath(workspace.path, relativePath);
  const exists = fs.existsSync(safe.absolutePath);
  const oldContent = exists ? fs.readFileSync(safe.absolutePath, "utf8") : "";
  const oldSha256 = exists ? fileSha256(workspace.path, safe.relativePath) : null;
  const newContent = content;
  const changed = newContent !== oldContent;
  const newSha256 = sha256Text(newContent);

  const result = {
    ok: true,
    path: safe.relativePath,
    operation: options.staged ? "stagedFullFileWrite" : "fullFileWrite",
    changed,
    oldSha256,
    newSha256: changed ? newSha256 : oldSha256,
    ...(dryRun ? { dryRun: true } : {})
  };

  if (changed && !dryRun) {
    const write = writeTextFileSafe(workspace.path, safe.relativePath, newContent);
    const verifiedSha256 = fileSha256(workspace.path, safe.relativePath);
    if (verifiedSha256 !== write.sha256) {
      throw new Error(`Fresh read verification failed for ${safe.relativePath}. Expected ${write.sha256}, got ${verifiedSha256 || "missing"}.`);
    }
    result.newSha256 = write.sha256;
    result.verified = write.verified === true;
    result.bytes = write.bytes;
  }

  const summary = {
    ok: true,
    dryRun,
    workspace: workspace.alias,
    operationId,
    changedFiles: changed ? [safe.relativePath] : [],
    result
  };

  appendOperation(config, workspace, {
    id: operationId,
    type: dryRun ? "write:dryRun" : "write",
    ok: true,
    paths: summary.changedFiles,
    results: [{
      path: safe.relativePath,
      operation: result.operation,
      changed,
      oldSha256,
      newSha256: result.newSha256,
      verified: dryRun || result.verified === true || !changed
    }]
  });

  return summary;
}

function stagedDir(config, workspace) {
  const safeAlias = String(workspace.alias || "workspace").replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(config.stateDir || path.join(process.cwd(), ".rel-ai-mcp-state"), "write-staging", safeAlias);
}

function stagedPath(config, workspace, writeId) {
  return path.join(stagedDir(config, workspace), `${validateWriteId(writeId)}.json`);
}

function validateWriteId(writeId) {
  const text = String(writeId || "").trim();
  if (!/^op_[a-z0-9]+_[a-f0-9]{12}$/.test(text)) throw new Error("Invalid or missing relai_write writeId.");
  return text;
}

function writeStagedPayload(config, workspace, writeId, payload) {
  const file = stagedPath(config, workspace, writeId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
}

function readStagedPayload(config, workspace, writeId) {
  const file = stagedPath(config, workspace, writeId);
  if (!fs.existsSync(file)) throw new Error(`No staged relai_write payload found for writeId ${writeId}. Start again with stage='start'.`);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  if (payload.workspace !== workspace.alias || payload.root !== workspace.path) throw new Error("Staged relai_write payload belongs to a different workspace.");
  return payload;
}

function deleteStagedPayload(config, workspace, writeId) {
  const file = stagedPath(config, workspace, writeId);
  const existed = fs.existsSync(file);
  if (existed) fs.rmSync(file, { force: true });
  return existed;
}

async function relaiVerify(workspace, config, args = {}) {
  const level = String(args.level || "standard").toLowerCase();
  const commands = normalizeVerifyCommands(args, workspace.path, level);
  if (commands.length === 0) return { ok: true, workspace: workspace.alias, level, commands: [], results: [], message: "No verification commands detected." };
  const stopOnFailure = args.stopOnFailure !== false;
  const results = [];
  for (const command of commands) {
    const result = await runProcess(command, [], {
      cwd: workspace.path,
      shell: true,
      commandString: command,
      timeout: clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 120000)
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
      timeout: clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 120000)
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

function readDirectory(workspace, relativePath, args) {
  const maxEntries = clampNumber(args.maxEntries, 1, 20000, 1000);
  const prefix = relativePath === "." ? "" : relativePath;
  const result = collectTextFiles(path.join(workspace.path, prefix), collectOptionsFromWorkspace(workspace, { maxEntries, includeRoots: [] }));
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

function normalizeVerifyCommands(args, root, level) {
  const explicit = [];
  if (typeof args.command === "string" && args.command.trim()) explicit.push(args.command.trim());
  if (Array.isArray(args.commands)) {
    for (const item of args.commands) {
      const command = String(item || "").trim();
      if (command) explicit.push(command);
    }
  }
  if (typeof args.commandsText === "string" && args.commandsText.trim()) {
    for (const line of args.commandsText.split(/\r?\n/)) {
      const command = line.trim();
      if (command && !command.startsWith("#")) explicit.push(command);
    }
  }
  if (explicit.length) return [...new Set(explicit)];
  return detectVerifyCommands(root, level);
}

function detectVerifyCommands(root, level) {
  const commands = [];
  const packageJson = path.join(root, "package.json");
  if (fs.existsSync(packageJson)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8"));
      const scripts = pkg.scripts || {};
      if (scripts.check) {
        commands.push("npm run check");
      } else if (level === "quick" && fs.existsSync(path.join(root, "src", "tools.js"))) {
        commands.push("node --check src/tools.js");
      }
      if (level !== "quick" && scripts.test) commands.push("npm test");
      if (level === "full" && scripts.build) commands.push("npm run build");
    } catch (_error) {
      if (level === "quick" && fs.existsSync(path.join(root, "src", "tools.js"))) commands.push("node --check src/tools.js");
    }
  }
  if (fs.existsSync(path.join(root, "pubspec.yaml"))) {
    if (level === "quick") {
      commands.push("dart analyze");
    } else {
      commands.push("flutter analyze");
      commands.push("flutter test");
    }
  }
  if (fs.existsSync(path.join(root, "pyproject.toml")) || fs.existsSync(path.join(root, "requirements.txt"))) commands.push("python -m pytest");
  if (fs.existsSync(path.join(root, "go.mod"))) commands.push("go test ./...");
  if (fs.existsSync(path.join(root, "Cargo.toml"))) commands.push("cargo test");
  return [...new Set(commands)];
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
