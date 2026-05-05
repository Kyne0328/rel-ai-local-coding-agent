const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getStateDir } = require("./audit");
const { collectTextFiles, readTextFileSafe, fileSha256 } = require("./safety");

function indexesDir(config) {
  return path.join(getStateDir(config), "indexes");
}

function indexKey(workspace, sessionId) {
  const raw = sessionId ? `${workspace.alias}--${sessionId}` : workspace.alias;
  return raw.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function indexPath(config, workspace, sessionId) {
  return path.join(indexesDir(config), `${indexKey(workspace, sessionId)}.json`);
}

function extractSymbols(relativePath, content) {
  const symbols = [];
  const ext = path.extname(relativePath).toLowerCase();
  const patterns = [];
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
    patterns.push(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g);
    patterns.push(/(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g);
    patterns.push(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g);
  } else if (ext === ".py") {
    patterns.push(/^\s*def\s+([A-Za-z_][\w]*)/gm);
    patterns.push(/^\s*class\s+([A-Za-z_][\w]*)/gm);
  } else if ([".go", ".rs", ".java", ".kt", ".cs", ".cpp", ".c", ".h"].includes(ext)) {
    patterns.push(/\b(?:func|fn|class|struct|interface)\s+([A-Za-z_][\w]*)/g);
  }
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) && symbols.length < 80) {
      symbols.push(match[1]);
    }
  }
  return [...new Set(symbols)];
}

function buildIndex(config, workspace, args = {}) {
  const maxFiles = Math.min(Math.max(Number(args.maxFiles || config.maxIndexFiles || 20000), 1), 100000);
  const maxFileBytes = Math.min(Math.max(Number(args.maxFileBytes || config.maxIndexFileBytes || config.maxSearchFileBytes || 300000), 1000), 5 * 1024 * 1024);
  const tree = collectTextFiles(workspace.path, { maxEntries: maxFiles, maxFileBytes });
  const files = [];
  for (const relativePath of tree.files) {
    try {
      const content = readTextFileSafe(workspace.path, relativePath, maxFileBytes);
      const lines = content.split(/\r?\n/);
      files.push({
        path: relativePath,
        ext: path.extname(relativePath).toLowerCase(),
        bytes: Buffer.byteLength(content, "utf8"),
        lines: lines.length,
        sha256: fileSha256(workspace.path, relativePath),
        symbols: extractSymbols(relativePath, content),
        fingerprint: crypto.createHash("sha1").update(`${relativePath}\0${content.slice(0, 4000)}`).digest("hex")
      });
    } catch (error) {
      tree.skipped.push({ path: relativePath, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const index = {
    ok: true,
    workspace: workspace.alias,
    sessionId: args.sessionId || workspace.taskSessionId || null,
    root: workspace.path,
    builtAt: new Date().toISOString(),
    fileCount: files.length,
    skippedCount: tree.skipped.length,
    truncated: tree.truncated,
    files,
    skipped: tree.skipped.slice(0, 1000)
  };
  fs.mkdirSync(indexesDir(config), { recursive: true, mode: 0o700 });
  fs.writeFileSync(indexPath(config, workspace, index.sessionId), `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  return index;
}

function readIndex(config, workspace, args = {}) {
  const sessionId = args.sessionId || workspace.taskSessionId || null;
  const file = indexPath(config, workspace, sessionId);
  if (!fs.existsSync(file)) throw new Error("Repository index does not exist. Run relai_index_build first.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function searchIndex(config, workspace, args = {}) {
  const query = String(args.query || "").trim().toLowerCase();
  if (!query) throw new Error("query is required.");
  const limit = Math.min(Math.max(Number(args.limit || 50), 1), 500);
  const index = readIndex(config, workspace, args);
  const matches = [];
  for (const file of index.files || []) {
    const haystack = `${file.path}\n${(file.symbols || []).join("\n")}`.toLowerCase();
    if (haystack.includes(query)) {
      matches.push(file);
      if (matches.length >= limit) break;
    }
  }
  return { ok: true, workspace: workspace.alias, sessionId: index.sessionId, query, builtAt: index.builtAt, matches };
}

function indexStats(config, workspace, args = {}) {
  const index = readIndex(config, workspace, args);
  const byExt = {};
  for (const file of index.files || []) byExt[file.ext || "[none]"] = (byExt[file.ext || "[none]"] || 0) + 1;
  return {
    ok: true,
    workspace: workspace.alias,
    sessionId: index.sessionId,
    builtAt: index.builtAt,
    fileCount: index.fileCount,
    skippedCount: index.skippedCount,
    truncated: index.truncated,
    byExt: Object.fromEntries(Object.entries(byExt).sort((a, b) => b[1] - a[1]))
  };
}

module.exports = { buildIndex, readIndex, searchIndex, indexStats };
