const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SECRET_PATH_GROUPS = Object.freeze({
  fileNames: ["id_rsa", "id_ed25519", ".npmrc", ".pypirc", ".netrc", "kubeconfig"],
  extensions: [".pem", ".key", ".p12", ".pfx"],
  directories: [".ssh", ".aws", ".azure", ".kube"]
});
const SECRET_PATH_PATTERNS = Object.freeze([
  ...SECRET_PATH_GROUPS.fileNames,
  ...SECRET_PATH_GROUPS.extensions,
  ...SECRET_PATH_GROUPS.directories
]);

const SECRET_EXTENSIONS = new Set(SECRET_PATH_GROUPS.extensions);
const SECRET_DIRECTORIES = new Set(SECRET_PATH_GROUPS.directories);
const PUBLIC_ENV_TEMPLATE_NAMES = new Set([
  ".env.example",
  ".env.template",
  ".env.sample",
  ".env.defaults"
]);
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
  '.svg', '.csv', '.tsv', '.properties', '.gradle', '.vue', '.svelte'
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

function sensitivePathError(value, label, operation = "legacy") {
  const classification = classifySensitivePath(value);
  const error = new Error(`${label} touches a blocked sensitive path: ${value}`);
  error.code = "SENSITIVE_PATH_RESTRICTED";
  error.source = "rel-ai-mcp-policy";
  error.path = value;
  error.fileClass = classification.classification;
  error.policyReason = classification.reason;
  error.operation = operation;
  error.retryable = false;
  error.requiresUserConfirmation = false;
  error.allowedAlternatives = [
    "Use a public environment template such as .env.example when appropriate.",
    "Use an ordinary non-sensitive repository path.",
    "Use a narrowly scoped operation that explicitly supports sensitive paths."
  ];
  return error;
}

function assertPathOperationAllowed(relativePath, operation = "legacy", options = {}) {
  if (!isSecretPath(relativePath)) return;
  if (operation === "commit" && options.allowSensitive === true) return;
  if (["env-list", "env-set", "env-remove", "env-compare", "review-redacted"].includes(operation) && isDotEnvPath(relativePath)) return;
  const contentDecision = evaluateSensitiveContent(relativePath, options.absolutePath, options.proposedContent);
  if (contentDecision.allowed) return;
  throw sensitivePathError(relativePath, options.label || "Path", operation);
}

function isDotEnvPath(relativePath) {
  const normalized = String(relativePath || "").replaceAll(WINDOWS_SEPARATOR, "/").toLowerCase();
  const leaf = normalized.split("/").filter(Boolean).at(-1) || "";
  return leaf === ".env" || leaf.startsWith(".env.") || leaf.startsWith(".env-");
}

function validateRelativePath(relativePath, label = "Path", options = {}) {
  const value = String(relativePath || "").replaceAll(WINDOWS_SEPARATOR, "/").trim();
  if (!value) throw new Error(`${label} cannot be empty.`);
  if (value.startsWith("/") || hasWindowsDrivePrefix(value)) {
    throw new Error(`${label} must be relative: ${value}`);
  }
  const segments = value.split("/");
  const parts = new Set(segments);
  if (parts.has("..") || parts.has("")) {
    throw new Error(`${label} must not contain traversal or empty segments: ${value}`);
  }
  // On Windows "<file>::$DATA" resolves to the file's default data stream, so a
  // stream suffix let ".env::$DATA" read .env while classifying as an ordinary file.
  // No legitimate repository path contains a colon in a segment.
  if (segments.some((segment) => segment.includes(":"))) {
    throw new Error(`${label} must not contain a drive or stream separator: ${value}`);
  }
  if (value.length > 512) throw new Error(`${label} is too long: ${value}`);
  if (options.skipSensitivePolicy !== true) {
    assertPathOperationAllowed(value, options.operation || "legacy", { ...options, label });
  }
  return value;
}

// Workspace roots are resolved once per tool call at minimum, and once per path for
// batch reads and batch edits. The root itself is a stable directory for the life of
// the process, so its realpath is memoized; the *candidate* path is still resolved
// every time, which is what actually detects a symlink escaping the workspace.
const REAL_ROOT_CACHE_LIMIT = 64;
const realRootCache = new Map();

function realRootOf(root) {
  const key = String(root);
  // A symlink or Windows junction can be retargeted while the server is running.
  // Never cache those roots: retaining the old realpath would make later operations
  // continue against a repository the configured path no longer points to.
  const cacheable = rootCanBeCached(key);
  if (cacheable) {
    const cached = realRootCache.get(key);
    if (cached !== undefined) return cached;
  }
  const resolved = fs.realpathSync(key);
  if (!cacheable) return resolved;
  if (realRootCache.size >= REAL_ROOT_CACHE_LIMIT) {
    realRootCache.delete(realRootCache.keys().next().value);
  }
  realRootCache.set(key, resolved);
  return resolved;
}

function rootCanBeCached(root) {
  try {
    return !fs.lstatSync(root).isSymbolicLink();
  } catch {
    return false;
  }
}

function clearRealRootCache() {
  realRootCache.clear();
}

function resolveSafePath(root, relativePath, options = {}) {
  const clean = validateRelativePath(relativePath, options.label || "Path", { ...options, skipSensitivePolicy: true });
  const realRoot = realRootOf(root);
  const absolute = path.resolve(realRoot, clean);
  const realCandidate = resolveRealCandidate(absolute);
  if (!isPathInside(realCandidate, realRoot)) {
    throw new Error(`Path escapes workspace: ${clean}`);
  }
  assertPathOperationAllowed(clean, options.operation || "legacy", {
    ...options,
    absolutePath: absolute,
    label: options.label || "Path"
  });
  return { relativePath: clean, absolutePath: absolute, realPath: realCandidate };
}

function resolveRealCandidate(absolutePath) {
  // realpathSync already fails for a missing path, so attempting it directly saves an
  // existsSync probe on the common case where the target exists.
  try {
    return fs.realpathSync(absolutePath);
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
  }
  const missingSegments = [];
  let ancestor = absolutePath;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    missingSegments.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync(ancestor);
  return path.resolve(realAncestor, ...missingSegments);
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isDotEnvName(leaf) {
  if (PUBLIC_ENV_TEMPLATE_NAMES.has(leaf)) return false;
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

function classifySensitivePath(relativePath) {
  const normalized = String(relativePath || "").replaceAll(WINDOWS_SEPARATOR, "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const leaf = segments.at(-1) || "";
  if (isDotEnvName(leaf)) return { sensitive: true, classification: "environment_secret", reason: "runtime environment file" };
  if (["id_rsa", "id_ed25519"].includes(leaf)) return { sensitive: true, classification: "private_key", reason: "private SSH key filename" };
  if ([".npmrc", ".pypirc", ".netrc"].includes(leaf)) return { sensitive: true, classification: "authentication_config", reason: "configuration file commonly stores credentials" };
  if (leaf === "kubeconfig") return { sensitive: true, classification: "cluster_credentials", reason: "Kubernetes client configuration" };
  if (isSensitiveJsonLeaf(leaf)) return { sensitive: true, classification: "service_account_credentials", reason: "service-account credential filename" };
  if (SECRET_EXTENSIONS.has(path.extname(leaf))) return { sensitive: true, classification: "key_or_certificate_bundle", reason: "private-key or credential-container extension" };
  if (segments.some((segment) => SECRET_DIRECTORIES.has(segment))) return { sensitive: true, classification: "credential_store", reason: "platform credential directory" };
  if (segments.some((segment) => isSecretNamedSegment(segment))) return { sensitive: true, classification: "secret_named_location", reason: "secret or credential named directory" };
  if (isSecretNamedFile(leaf)) return { sensitive: true, classification: "secret_named_file", reason: "secret or credential named file" };
  if (normalized.includes("gcloud/credentials")) return { sensitive: true, classification: "cloud_credentials", reason: "Google Cloud credential path" };
  return { sensitive: false, classification: "ordinary_repository_file", reason: "no sensitive path rule matched" };
}

function isSecretPath(relativePath) {
  return classifySensitivePath(relativePath).sensitive;
}

function evaluateSensitiveContent(relativePath, absolutePath, proposedContent) {
  const classification = classifySensitivePath(relativePath);
  if (!classification.sensitive) return { allowed: true, reason: "ordinary path" };
  if (!["authentication_config", "key_or_certificate_bundle", "secret_named_location", "secret_named_file"].includes(classification.classification)) {
    return { allowed: false, reason: classification.reason };
  }
  const source = proposedContent !== undefined
    ? String(proposedContent)
    : readCandidateText(absolutePath);
  if (source == null) return { allowed: false, reason: "content unavailable or binary" };
  const leaf = String(relativePath || "").replaceAll(WINDOWS_SEPARATOR, "/").toLowerCase().split("/").at(-1) || "";
  if (leaf.endsWith(".pem")) return evaluatePemContent(source);
  if (leaf === ".npmrc" || leaf === ".pypirc") return evaluateAuthConfigContent(source);
  if (leaf === ".netrc") return { allowed: false, reason: ".netrc is inherently credential-oriented" };
  return containsCredentialMaterial(source)
    ? { allowed: false, reason: "credential-like content detected" }
    : { allowed: true, reason: "no credential material detected" };
}

function readCandidateText(absolutePath) {
  try {
    if (!absolutePath || !fs.existsSync(absolutePath)) return null;
    const data = fs.readFileSync(absolutePath);
    if (data.length > 1024 * 1024 || looksBinary(data)) return null;
    return data.toString("utf8");
  } catch {
    return null;
  }
}

function evaluatePemContent(source) {
  if (/-----BEGIN [^-]*PRIVATE KEY-----/i.test(source)) {
    return { allowed: false, reason: "private key block detected" };
  }
  const blocks = [...source.matchAll(/-----BEGIN ([^-]+)-----/g)].map((match) => match[1].trim().toUpperCase());
  if (blocks.length === 0) return { allowed: false, reason: "unrecognized PEM content" };
  const publicBlocks = new Set(["CERTIFICATE", "PUBLIC KEY", "RSA PUBLIC KEY", "CERTIFICATE REQUEST"]);
  return blocks.every((block) => publicBlocks.has(block))
    ? { allowed: true, reason: "public certificate or public-key PEM" }
    : { allowed: false, reason: "non-public PEM block detected" };
}

function evaluateAuthConfigContent(source) {
  const activeLines = String(source).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !line.startsWith(";"));
  return activeLines.some((line) => containsCredentialMaterial(line))
    ? { allowed: false, reason: "credential assignment detected" }
    : { allowed: true, reason: "public configuration without credential assignments" };
}

function containsCredentialMaterial(source) {
  const text = String(source);
  if (/-----BEGIN [^-]*PRIVATE KEY-----/i.test(text)) return true;
  if (/(?:^|[\s/:])_authToken\s*=\s*[^\s#;]+/im.test(text)) return true;
  if (/\b(?:password|passwd|token|auth[_-]?token|api[_-]?key|client[_-]?secret|access[_-]?key|secret[_-]?key|_auth|username)\s*[:=]\s*[^\s#;]+/i.test(text)) return true;
  if (/\/\/[A-Za-z0-9._%+-]+:[^@\s/]+@/i.test(text)) return true;
  if (/\b(?:ghp|github_pat|glpat|sk_live|sk_test)_[A-Za-z0-9_-]{8,}\b/.test(text)) return true;
  return false;
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
    realRoot: realRootOf(root),
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

// The walk starts at the workspace realpath and processTextEntry refuses every
// symbolic link (junctions and reparse points included) before recursing, so an entry
// reached here cannot resolve outside the root. Asserting containment with a string
// compare instead of a realpathSync per file removes one syscall per repository file —
// it dominated the snapshot and code-index walks on Windows.
function inspectTextFile(context, abs, rel) {
  try {
    if (!isPathInside(abs, context.realRoot)) {
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
  const context = workspace?.context && typeof workspace.context === "object" ? workspace.context : {};
  return {
    includeRoots: context.includeRoots || context.includePaths || [],
    excludePaths: context.excludePaths || [],
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
    return "outside context include roots";
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
  const resolved = resolveSafePath(root, relativePath, { operation: "read" });
  if (!fs.existsSync(resolved.absolutePath)) return null;
  const stat = fs.statSync(resolved.absolutePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${resolved.relativePath}`);
  return crypto.createHash("sha256").update(fs.readFileSync(resolved.absolutePath)).digest("hex");
}

function writeTextFileSafe(root, relativePath, content, options = {}) {
  const resolved = resolveSafePath(root, relativePath, { operation: "write", proposedContent: String(content ?? "") });
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
  clearRealRootCache,
  realRootOf,
  validateRelativePath,
  resolveSafePath,
  assertPathOperationAllowed,
  isPathInside,
  isSecretPath,
  classifySensitivePath,
  evaluateSensitiveContent,
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
    throw new Error('Refusing likely collapsed full-file edit for ' + relativePath + ': existing file has ' + oldLines + ' lines but new content has ' + newLines + '. Use relai_read and pass complete multiline content to relai_edit.');
  }
}
