import { packageMetadata, resolvePackagePath } from './packageMetadata.js';
import * as fs from "node:fs";

// Single source of truth for the human-facing product version. Read it straight
// from CHANGELOG.md (the first "## [version] — date" heading) so every surface —
// /health, relai_work status, release readiness — reports the
// same value the release notes advertise. package.json is only a last-resort fallback
// (e.g. CHANGELOG missing from a partial bundle).
let _pkgVersion = "";
try { _pkgVersion = packageMetadata.version || ""; } catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] package version:', error); }

// CHANGELOG.md is ~112 KB and getVersion() is called on /health, relai_work status and
// every MCP response, so cache the parse and re-read only when the file changes.
let _changelogCache = { mtimeMs: -1, size: -1, version: "" };

function readChangelogVersion() {
  const file = resolvePackagePath('CHANGELOG.md');
  try {
    const stat = fs.statSync(file);
    if (stat.mtimeMs === _changelogCache.mtimeMs && stat.size === _changelogCache.size) {
      return _changelogCache.version;
    }
    const md = fs.readFileSync(file, "utf8");
    // Match the first "## [x.y.z] — date" (em dash or hyphen) heading.
    const match = md.match(/^##\s*\[([^\]]+)\]/m);
    const version = match?.[1] ? match[1].trim() : "";
    _changelogCache = { mtimeMs: stat.mtimeMs, size: stat.size, version };
    return version;
  } catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] changelog version:', error); }
  return "";
}

function getVersion() {
  return readChangelogVersion() || _pkgVersion;
}

export { getVersion };
