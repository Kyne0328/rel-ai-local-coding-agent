const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SECRET_PATH_GROUPS = Object.freeze({
  fileNames: ["id_rsa", "id_ed25519", "known_hosts", ".npmrc", ".pypirc", ".netrc", "kubeconfig"],
  extensions: [".pem", ".key", ".p12", ".pfx"],
  directories: [".ssh", ".aws", ".azure", ".kube"]
});
const SECRET_PATH_PATTERNS = Object.freeze([
  ...SECRET_PATH_GROUPS.fileNames,
  ...SECRET_PATH_GROUPS.extensions,
  ...SECRET_PATH_GROUPS.directories
]);

const SECRET_FILE_NAMES = new Set(SECRET_PATH_GROUPS.fileNames);
const SECRET_EXTENSIONS = new Set(SECRET_PATH_GROUPS.extensions);
const SECRET_DIRECTORIES = new Set(SECRET_PATH_GROUPS.directories);
const WINDOWS_SEPARATOR = path.win32.sep;
const DEFAULT_EXCLUDED_NAMES = new Set([
  ".git", "node_modules", "dist", "build", "coverage", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".cache", ".parcel-cache", ".vite", ".pytest_cache", "__pycache__",
  ".venv", "venv", "target", "bin", "obj", "DerivedData", ".gradle", ".idea", ".vscode",
  "vendor", ".pnpm-store", ".yarn/cache", "storybook-static", ".nyc_output", "htmlcov",
  ".dart_tool", ".flutter-plugins", ".flutter-plugins-dependencies", ".pub-cache", ".pub",
  ".mypy_cache", ".ruff_cache", ".tox", ".nox", ".hypothesis", ".eggs", "site-packages",
  ".coverage", ".angular", ".expo", ".serverless",
  ".terraform", ".bloop", ".metals", ".scala-build", ".stack-work", ".cabal",
  "Pods", "Carthage", "xcuserdata", ".vs", "cmake-build-debug", "cmake-build-release",
  ".rel-ai-mcp", ".rel-ai-mcp-state", ".relai"
]);

// Files with these extensions skip the per-file 8 KB binary sniff during the
// snapshot walk — the open/read per file dominates snapshot cost on Windows.
const KNOWN_TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.dart', '.py', '.go', '.rs',
  '.java', '.kt', '.swift', '.cs', '.cpp', '.c', '.h', '.hpp', '.rb', '.php',
  '.css', '.scss', '.html', '.xml', '.yaml', '.yml', '.json', '.md', '.txt',
  '.sql', '.sh', '.bat', '.ps1', '.toml', '.ini', '.cfg', '.conf', '.lock',
  '.svg', '.csv', '.tsv', '.properties', '.gradle', '.vue', '.svelte', '.env.example'
]);

const DEFAULT_EXCLUDED_PATHS = [
  "android/.gradle",
  "ios/Flutter/ephemeral",
  "macos/Flutter/ephemeral",
  "windows/flutter/ephemeral",
  "linux/flutter/ephemeral",
  ".claude/skills",
  ".superpowers",
  ".rel-ai-mcp",
  ".rel-ai-mcp-state",
  ".relai"
];

function hasWindowsDrivePrefix(value) {
  return value.length >= 3
    && value[1] === ":"
    && value[2] === "/"
    && /[A-Za-z]/.test(value[0]);
}

function validateRelativePath(relativePath, label = "Path") {
  const value = String(relativePath || "").replaceAll(WINDOWS_SEPARATOR, "/").trim();
  if (!value) throw new Error(`${label} cannot be empty.`);
  if (value.startsWith("/") || hasWindowsDrivePrefix(value)) {
    throw new Error(`${label} must be relative: ${value}`);
  }
  const parts = new Set(value.split("/"));
  if (parts.has("..") || parts.has("")) {
    throw new Error(`${label} must not contain traversal or empty segments: ${value}`);
  }
  if (value.length > 512) throw new Error(`${label} is too long: ${value}`);
  if (isSecretPath(value)) throw new Error(`${label} touches a blocked sensitive path: ${value}`);
  return value;
}

function resolveSafePath(root, relativePath) {
  const clean = validateRelativePath(relativePath);
  const realRoot = fs.realpathSync(root);
  const absolute = path.resolve(realRoot, clean);
  const realCandidate = fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute;
  if (!isPathInside(realCandidate, realRoot)) {
    throw new Error(`Path escapes workspace: ${clean}`);
  }
  return { relativePath: clean, absolutePath: absolute, realPath: realCandidate };
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isDotEnvName(leaf) {
  return leaf === ".env" || leaf.startsWith(".env.") || leaf.startsWith(".env-");
}

function isSecretNamedSegment(segment) {
  return segment === "secret" || segment === "secrets" || segment === "credential" || segment === "credentials";
}

function isSecretNamedFile(leaf) {
  return leaf.startsWith("secret.")
    || leaf.startsWith("secrets.")
    || leaf.startsWith("credential.")
    || leaf.startsWith("credentials.");
}

function isSensitiveJsonLeaf(leaf) {
  return (leaf.startsWith("firebase-adminsdk") || leaf.startsWith("service-account")) && leaf.endsWith(".json");
}

function isSecretPath(relativePath) {
  const normalized = String(relativePath || "").replaceAll(WINDOWS_SEPARATOR, "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const leaf = segments.at(-1) || "";
  if (isDotEnvName(leaf) || SECRET_FILE_NAMES.has(leaf) || isSensitiveJsonLeaf(leaf)) return true;
  if (SECRET_EXTENSIONS.has(path.extname(leaf))) return true;
  if (segments.some((segment) => SECRET_DIRECTORIES.has(segment) || isSecretNamedSegment(segment))) return true;
  if (isSecretNamedFile(leaf)) return true;
  return normalized.includes("gcloud/credentials");
}

function looksBinary(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function collectTextFiles(root, options = {}) {
  const context = {
    maxEntries: options.maxEntries || Infinity,
    files: [],
    skipped: [],
    realRoot: fs.realpathSync(root),
    policy: null
  };
  context.policy = buildCollectionPolicy(context.realRoot, options);
  walkTextFiles(context, context.realRoot, "");
  return { files: context.files, skipped: context.skipped, truncated: context.files.length >= context.maxEntries };
}

function readDirectoryEntries(dir, prefix, skipped) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    skipped.push({ path: prefix || ".", reason: error.message });
    return [];
  }
}

function walkTextFiles(context, dir, prefix) {
  if (context.files.length >= context.maxEntries) return;
  for (const entry of readDirectoryEntries(dir, prefix, context.skipped)) {
    if (context.files.length >= context.maxEntries) break;
    processTextEntry(context, dir, prefix, entry);
  }
}

function skipReasonForEntry(rel, entry, policy) {
  if (isSecretPath(rel)) return "blocked sensitive path";
  const excluded = shouldExcludeRelativePath(rel, entry.name, policy);
  if (excluded) return excluded;
  if (entry.isSymbolicLink()) return "symlink skipped";
  return "";
}

function processTextEntry(context, dir, prefix, entry) {
  const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
  const skipReason = skipReasonForEntry(rel, entry, context.policy);
  if (skipReason) {
    context.skipped.push({ path: rel, reason: skipReason });
    return;
  }
  const abs = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    walkTextFiles(context, abs, rel);
    return;
  }
  if (entry.isFile()) inspectTextFile(context, abs, rel);
}

function inspectTextFile(context, abs, rel) {
  try {
    const real = fs.realpathSync(abs);
    if (!isPathInside(real, context.realRoot)) {
      context.skipped.push({ path: rel, reason: "escapes workspace" });
      return;
    }
    const ext = path.extname(rel).toLowerCase();
    if (!KNOWN_TEXT_EXTENSIONS.has(ext) && fileLooksBinary(abs)) {
      context.skipped.push({ path: rel, reason: "binary-looking file" });
      return;
    }
    context.files.push(rel);
  } catch (error) {
    context.skipped.push({ path: rel, reason: error.message });
  }
}

function fileLooksBinary(abs) {
  const buf = Buffer.allocUnsafe(8000);
  const fd = fs.openSync(abs, "r");
  try {
    const bytesRead = fs.readSync(fd, buf, 0, 8000, 0);
    return looksBinary(buf.subarray(0, bytesRead));
  } finally {
    fs.closeSync(fd);
  }
}

function buildCollectionPolicy(root, options = {}) {
  const includeRoots = normalizePathList(options.includeRoots || options.includePaths || []);
  const excludePaths = [
    ...DEFAULT_EXCLUDED_PATHS,
    ...normalizePathList(options.excludePaths || []),
    ...readRelaiIgnore(root)
  ];
  return {
    includeRoots,
    excludePaths: normalizePathList(excludePaths),
    excludeNames: new Set([...DEFAULT_EXCLUDED_NAMES, ...normalizePathList(options.excludeNames || [])])
  };
}

function collectOptionsFromWorkspace(workspace, overrides = {}) {
  const fastTask = workspace?.fastTask && typeof workspace.fastTask === "object" ? workspace.fastTask : {};
  if (fastTask.enabled === false) return { ...overrides };
  return {
    includeRoots: fastTask.includeRoots || fastTask.includePaths || [],
    excludePaths: fastTask.excludePaths || [],
    ...overrides
  };
}

function readRelaiIgnore(root) {
  try {
    const file = path.join(root, ".relaiignore");
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.split("#")[0].trim())
      .filter(Boolean);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] .relaiignore:', error);
    return [];
  }
}

function normalizePathList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  return list.map((item) => {
    let normalized = String(item || "").replaceAll(WINDOWS_SEPARATOR, "/").trim();
    if (normalized.startsWith("./")) normalized = normalized.slice(2);
    while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
    return normalized;
  }).filter(Boolean);
}

function isInsideIncludedRoot(normalized, root) {
  return normalized === root || normalized.startsWith(root + "/") || root.startsWith(normalized + "/");
}

function shouldExcludeRelativePath(rel, name, policy) {
  const normalized = String(rel || "").replaceAll(WINDOWS_SEPARATOR, "/");
  if (policy.includeRoots.length && !policy.includeRoots.some((root) => isInsideIncludedRoot(normalized, root))) {
    return "outside fast-task include roots";
  }
  if (policy.excludeNames.has(name) || policy.excludeNames.has(normalized)) return "excluded generated/cache folder";
  for (const pattern of policy.excludePaths) {
    if (matchesIgnorePattern(normalized, pattern)) return "excluded by context policy";
  }
  return "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function matchesIgnorePattern(rel, pattern) {
  const raw = String(pattern || "").replaceAll(WINDOWS_SEPARATOR, "/").trim();
  if (!raw) return false;
  const anchored = raw.startsWith("/");
  let clean = anchored ? raw.slice(1) : raw;
  while (clean.endsWith("/")) clean = clean.slice(0, -1);
  if (!clean) return false;
  if (!clean.includes("*")) {
    if (anchored) return rel === clean || rel.startsWith(clean + "/");
    return rel === clean || rel.startsWith(clean + "/") || rel.includes("/" + clean + "/") || rel.endsWith("/" + clean);
  }
  const escaped = clean.split("*").map(escapeRegExp).join(".*");
  const regex = new RegExp(anchored ? `^${escaped}(?:/|$)` : `(^|/)${escaped}(?:/|$)`);
  return regex.test(rel);
}

function fileSha256(root, relativePath) {
  const resolved = resolveSafePath(root, relativePath);
  if (!fs.existsSync(resolved.absolutePath)) return null;
  const stat = fs.statSync(resolved.absolutePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${resolved.relativePath}`);
  return crypto.createHash("sha256").update(fs.readFileSync(resolved.absolutePath)).digest("hex");
}

function writeTextFileSafe(root, relativePath, content, options = {}) {
  const resolved = resolveSafePath(root, relativePath);
  const text = String(content ?? "");
  if (looksBinary(Buffer.from(text, "utf8"))) throw new Error("Refusing to write binary-looking content.");
  guardAgainstCollapsedFullFileWrite(resolved.absolutePath, resolved.relativePath, text);
  if (options.expectedSha256) {
    const current = fileSha256(root, resolved.relativePath);
    if (current !== options.expectedSha256) {
      throw new Error(`SHA mismatch for ${resolved.relativePath}. Expected ${options.expectedSha256}, got ${current || "missing"}.`);
    }
  }

  const expectedWrittenSha256 = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  const existingMode = fs.existsSync(resolved.absolutePath) ? fs.statSync(resolved.absolutePath).mode & 0o7777 : null;
  fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });

  const tmpName = `.${path.basename(resolved.absolutePath)}.${process.pid}.${Date.now()}.tmp`;
  const tmpPath = path.join(path.dirname(resolved.absolutePath), tmpName);
  try {
    fs.writeFileSync(tmpPath, text, "utf8");
    if (existingMode != null) fs.chmodSync(tmpPath, existingMode);
    const tmpSha256 = crypto.createHash("sha256").update(fs.readFileSync(tmpPath)).digest("hex");
    if (tmpSha256 !== expectedWrittenSha256) {
      throw new Error(`Temporary write verification failed for ${resolved.relativePath}. Expected ${expectedWrittenSha256}, got ${tmpSha256}.`);
    }
    fs.renameSync(tmpPath, resolved.absolutePath);
  } catch (error) {
    cleanupTempFile(tmpPath);
    throw error;
  }

  const reread = fs.readFileSync(resolved.absolutePath);
  const actualSha256 = crypto.createHash("sha256").update(reread).digest("hex");
  if (actualSha256 !== expectedWrittenSha256) {
    throw new Error(`Post-write verification failed for ${resolved.relativePath}. Expected ${expectedWrittenSha256}, got ${actualSha256}.`);
  }
  return {
    path: resolved.relativePath,
    sha256: actualSha256,
    expectedSha256: expectedWrittenSha256,
    verified: true,
    bytes: Buffer.byteLength(text, "utf8")
  };
}

function cleanupTempFile(tmpPath) {
  try {
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] cleanup temp file:', error);
  }
}

function safeReadJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`[rel-ai-mcp] Failed to read JSON at ${file}: ${err.message}`);
    return fallback;
  }
}

module.exports = {
  SECRET_PATH_PATTERNS,
  DEFAULT_EXCLUDED_NAMES,
  validateRelativePath,
  resolveSafePath,
  isPathInside,
  isSecretPath,
  looksBinary,
  collectTextFiles,
  collectOptionsFromWorkspace,
  writeTextFileSafe,
  fileSha256,
  safeReadJson
};

function guardAgainstCollapsedFullFileWrite(absolutePath, relativePath, newText) {
  if (!fs.existsSync(absolutePath)) return;
  let oldText;
  try {
    oldText = fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] collapsed-write guard:', error);
    return;
  }
  const oldLines = oldText.split(/\r?\n/).length;
  const newLines = newText.split(/\r?\n/).length;
  const ext = path.extname(relativePath).toLowerCase();
  const sourceLike = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.dart', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.cs', '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.css', '.scss', '.html', '.xml', '.yaml', '.yml', '.json', '.md']);
  if (sourceLike.has(ext) && oldLines >= 8 && newLines <= 2 && newText.length > 500) {
    throw new Error('Refusing likely collapsed full-file write for ' + relativePath + ': existing file has ' + oldLines + ' lines but new content has ' + newLines + '. Use relai_read and pass the complete multiline file content to relai_write.');
  }
}
