const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SECRET_PATH_PATTERNS = [
  /(^|\/)\.env($|[./-])/i,
  /(^|\/)\.ssh($|\/)/i,
  /(^|\/)(id_rsa|id_ed25519|known_hosts)$/i,
  /(^|\/).*\.(pem|key|p12|pfx)$/i,
  /(^|\/)(secrets?|credentials?)(\.|\/|$)/i,
  /(^|\/)(\.npmrc|\.pypirc|\.netrc)$/i,
  /(^|\/)firebase-adminsdk[^/]*\.json$/i,
  /(^|\/)service-account[^/]*\.json$/i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.azure\//i,
  /(^|\/)gcloud\/credentials/i,
  /(^|\/)(kubeconfig|\.kube)(\/|$)/i
];

const DEFAULT_EXCLUDED_NAMES = new Set([
  ".git", "node_modules", "dist", "build", "coverage", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".cache", ".parcel-cache", ".vite", ".pytest_cache", "__pycache__",
  ".venv", "venv", "target", "bin", "obj", "DerivedData", ".gradle", ".idea", ".vscode",
  "vendor", ".pnpm-store", ".yarn/cache", "storybook-static", ".nyc_output", "htmlcov",
  ".dart_tool", ".flutter-plugins", ".flutter-plugins-dependencies", ".pub-cache", ".pub",
  ".mypy_cache", ".ruff_cache", ".tox", ".nox", ".hypothesis", ".eggs", "site-packages",
  ".pytest_cache", ".coverage", ".parcel-cache", ".angular", ".expo", ".serverless",
  ".terraform", ".bloop", ".metals", ".scala-build", ".stack-work", ".cabal",
  "Pods", "Carthage", "DerivedData", "xcuserdata", ".vs", "cmake-build-debug", "cmake-build-release"
]);

const DEFAULT_EXCLUDED_PATHS = [
  "android/.gradle",
  "ios/Flutter/ephemeral",
  "macos/Flutter/ephemeral",
  "windows/flutter/ephemeral",
  "linux/flutter/ephemeral",
  ".claude/skills",
  ".superpowers"
];

function validateRelativePath(relativePath, label = "Path") {
  const value = String(relativePath || "").replace(/\\/g, "/").trim();
  if (!value) throw new Error(`${label} cannot be empty.`);
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
    throw new Error(`${label} must be relative: ${value}`);
  }
  const parts = value.split("/");
  if (parts.includes("..") || parts.includes("")) {
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

function isSecretPath(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksBinary(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function extractPathsFromDiff(diff) {
  const paths = [];
  for (const line of String(diff || "").split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/);
      if (match) {
        paths.push(stripQuotedPath(match[1]));
        paths.push(stripQuotedPath(match[2]));
      }
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const raw = line.slice(4).trim().split(/\s+/)[0];
      if (raw === "/dev/null") continue;
      if (raw.startsWith("a/") || raw.startsWith("b/")) paths.push(stripQuotedPath(raw.slice(2)));
    }
  }
  return [...new Set(paths.filter(Boolean))];
}

function validateDiffPaths(diff, root) {
  const paths = extractPathsFromDiff(diff);
  if (paths.length === 0) throw new Error("Diff does not contain recognizable file paths.");
  for (const relativePath of paths) {
    if (relativePath === "/dev/null") continue;
    resolveSafePath(root, relativePath);
  }
  return paths;
}

function stripQuotedPath(input) {
  let value = String(input || "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return decodeGitOctalEscapes(value);
}

function decodeGitOctalEscapes(value) {
  return value.replace(/(\\[0-7]{3})+/g, (run) => {
    const bytes = run.match(/\\([0-7]{3})/g).map((m) => parseInt(m.slice(1), 8));
    return Buffer.from(bytes).toString("utf8");
  });
}

function collectTextFiles(root, options = {}) {
  const maxEntries = options.maxEntries || Infinity;
  const files = [];
  const skipped = [];
  const realRoot = fs.realpathSync(root);
  const policy = buildCollectionPolicy(realRoot, options);

  function walk(dir, prefix) {
    if (files.length >= maxEntries) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      skipped.push({ path: prefix || ".", reason: error.message });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxEntries) break;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isSecretPath(rel)) {
        skipped.push({ path: rel, reason: "blocked sensitive path" });
        continue;
      }
      const excluded = shouldExcludeRelativePath(rel, entry.name, policy);
      if (excluded) {
        skipped.push({ path: rel, reason: excluded });
        continue;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        skipped.push({ path: rel, reason: "symlink skipped" });
        continue;
      }
      if (entry.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const real = fs.realpathSync(abs);
        if (!isPathInside(real, realRoot)) {
          skipped.push({ path: rel, reason: "escapes workspace" });
          continue;
        }
        const data = fs.readFileSync(abs);
        if (looksBinary(data)) {
          skipped.push({ path: rel, reason: "binary-looking file" });
          continue;
        }
        files.push(rel);
      } catch (error) {
        skipped.push({ path: rel, reason: error.message });
      }
    }
  }

  walk(realRoot, "");
  return { files, skipped, truncated: files.length >= maxEntries };
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
  const fastTask = workspace && workspace.fastTask && typeof workspace.fastTask === "object" ? workspace.fastTask : {};
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
      .map((line) => line.replace(/#.*/, "").trim())
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function normalizePathList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  return list.map((item) => String(item || "").replace(/\\/g, "/").trim().replace(/^\.\//, "").replace(/\/$/, "")).filter(Boolean);
}

function shouldExcludeRelativePath(rel, name, policy) {
  const normalized = String(rel || "").replace(/\\/g, "/");
  if (policy.includeRoots.length && !policy.includeRoots.some((root) => normalized === root || normalized.startsWith(root + "/") || root.startsWith(normalized + "/"))) {
    return "outside fast-task include roots";
  }
  if (policy.excludeNames.has(name) || policy.excludeNames.has(normalized)) return "excluded generated/cache folder";
  for (const pattern of policy.excludePaths) {
    if (matchesIgnorePattern(normalized, pattern)) return "excluded by context policy";
  }
  return "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesIgnorePattern(rel, pattern) {
  const raw = String(pattern || "").replace(/\\/g, "/").trim();
  if (!raw) return false;
  const anchored = raw.startsWith("/");
  const clean = raw.replace(/^\//, "").replace(/\/$/, "");
  if (!clean) return false;
  if (!clean.includes("*")) {
    if (anchored) return rel === clean || rel.startsWith(clean + "/");
    return rel === clean || rel.startsWith(clean + "/") || rel.includes("/" + clean + "/") || rel.endsWith("/" + clean);
  }
  const escaped = clean.split("*").map(escapeRegExp).join(".*");
  const regex = new RegExp(anchored ? `^${escaped}(?:/|$)` : `(^|/)${escaped}(?:/|$)`);
  return regex.test(rel);
}

function readTextFileSafe(root, relativePath) {
  const resolved = resolveSafePath(root, relativePath);
  const stat = fs.statSync(resolved.absolutePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${resolved.relativePath}`);
  const data = fs.readFileSync(resolved.absolutePath);
  if (looksBinary(data)) throw new Error(`Binary-looking file skipped: ${resolved.relativePath}`);
  return data.toString("utf8");
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
  if (options.expectedSha256) {
    const current = fileSha256(root, resolved.relativePath);
    if (current !== options.expectedSha256) {
      throw new Error(`SHA mismatch for ${resolved.relativePath}. Expected ${options.expectedSha256}, got ${current || "missing"}.`);
    }
  }

  const expectedWrittenSha256 = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });

  const tmpName = `.${path.basename(resolved.absolutePath)}.${process.pid}.${Date.now()}.tmp`;
  const tmpPath = path.join(path.dirname(resolved.absolutePath), tmpName);
  try {
    fs.writeFileSync(tmpPath, text, "utf8");
    const tmpSha256 = crypto.createHash("sha256").update(fs.readFileSync(tmpPath)).digest("hex");
    if (tmpSha256 !== expectedWrittenSha256) {
      throw new Error(`Temporary write verification failed for ${resolved.relativePath}. Expected ${expectedWrittenSha256}, got ${tmpSha256}.`);
    }
    fs.renameSync(tmpPath, resolved.absolutePath);
  } catch (error) {
    try { if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true }); } catch (_cleanupError) {}
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

function safeCommandPolicy(command) {
  const text = String(command || "");
  const banned = [
    /\brm\s+-rf\b/,
    /\bsudo\b/,
    /\bmkfs\b/,
    /\bdd\s+if=/,
    /:\(\)\s*\{\s*:\|:/,
    />\s*\/dev\/sd[a-z]/,
    /\bchmod\s+-R\s+777\b/,
    /\bchown\s+-R\b/,
    /\bshutdown\b|\breboot\b/,
    /\bdeploy\b.*\bprod/i
  ];
  const hit = banned.find((pattern) => pattern.test(text));
  if (hit) throw new Error(`Command rejected by safety policy: ${hit}`);
  return text;
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
  extractPathsFromDiff,
  validateDiffPaths,
  collectTextFiles,
  collectOptionsFromWorkspace,
  readTextFileSafe,
  writeTextFileSafe,
  fileSha256,
  safeCommandPolicy,
  safeReadJson
};
