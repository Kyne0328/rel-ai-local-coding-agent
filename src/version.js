const fs = require("node:fs");
const path = require("node:path");

// Single source of truth for the human-facing product version. Read it straight
// from CHANGELOG.md (the first "## [version] — date" heading) so every surface —
// /health, relai_status, release readiness — reports the
// same value the release notes advertise. package.json is only a last-resort fallback
// (e.g. CHANGELOG missing from a partial bundle).
let _pkgVersion = "";
try { _pkgVersion = require("../package.json").version || ""; } catch (_error) { /* ignore */ }

function readChangelogVersion() {
  try {
    const md = fs.readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf8");
    // Match the first "## [x.y.z] — date" (em dash or hyphen) heading.
    const match = md.match(/^##\s*\[([^\]]+)\]/m);
    if (match?.[1]) return match[1].trim();
  } catch (_error) { /* fall through to package.json */ }
  return "";
}

function getVersion() {
  return readChangelogVersion() || _pkgVersion;
}

module.exports = { getVersion };
