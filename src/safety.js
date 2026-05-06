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
  "vendor", ".pnpm-store", ".yarn/cache", "storybook-static", ".nyc_output", "htmlcov"
]);

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
  const maxEntries = options.maxEntries || 5000;
  const maxFileBytes = options.maxFileBytes || 300000;
  const files = [];
  const skipped = [];
  const realRoot = fs.realpathSync(root);

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
      if (DEFAULT_EXCLUDED_NAMES.has(entry.name) || DEFAULT_EXCLUDED_NAMES.has(rel)) {
        skipped.push({ path: rel, reason: "excluded generated/cache folder" });
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
        const stat = fs.statSync(abs);
        if (stat.size > maxFileBytes) {
          skipped.push({ path: rel, reason: `larger than ${maxFileBytes} bytes` });
          continue;
        }
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

function readTextFileSafe(root, relativePath, maxBytes) {
  const resolved = resolveSafePath(root, relativePath);
  const stat = fs.statSync(resolved.absolutePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${resolved.relativePath}`);
  if (stat.size > maxBytes) throw new Error(`File larger than ${maxBytes} bytes: ${resolved.relativePath}`);
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
  const maxBytes = options.maxBytes || 600000;
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error(`Refusing to write ${resolved.relativePath}; content exceeds ${maxBytes} bytes.`);
  }
  if (looksBinary(Buffer.from(text, "utf8"))) throw new Error("Refusing to write binary-looking content.");
  if (options.expectedSha256) {
    const current = fileSha256(root, resolved.relativePath);
    if (current !== options.expectedSha256) {
      throw new Error(`SHA mismatch for ${resolved.relativePath}. Expected ${options.expectedSha256}, got ${current || "missing"}.`);
    }
  }
  fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
  fs.writeFileSync(resolved.absolutePath, text, "utf8");
  return { path: resolved.relativePath, sha256: fileSha256(root, resolved.relativePath), bytes: Buffer.byteLength(text, "utf8") };
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
  readTextFileSafe,
  writeTextFileSafe,
  fileSha256,
  safeCommandPolicy,
  safeReadJson
};
