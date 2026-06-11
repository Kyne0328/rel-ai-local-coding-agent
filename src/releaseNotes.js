const fs = require("node:fs");
const path = require("node:path");

// Last-resort fallback if CHANGELOG.md cannot be read/parsed. Use the package
// version so the dashboard never renders a bare "v" (the packaged launcher hit this
// when CHANGELOG wasn't bundled).
let PKG_VERSION = "";
try { PKG_VERSION = require("../package.json").version || ""; } catch (_error) { /* ignore */ }
const FALLBACK = {
  version: PKG_VERSION,
  headline: "See CHANGELOG.md for the latest changes.",
  bullets: []
};

// Strip the markdown that appears in CHANGELOG bullets so the dashboard shows plain
// readable text: bold/italic, inline code, and [text](link) -> text.
function stripMarkdown(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    // Italic underscores only when bounded by whitespace/edges — never strip the
    // underscores inside identifiers like relai_apply_update.
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1$2")
    .trim();
}

function parseChangelog(md) {
  // First "## [version] — date" heading (em dash or hyphen).
  const heading = md.match(/^##\s*\[([^\]]+)\]\s*[—–-]\s*(.+)$/m);
  if (!heading) return null;
  const version = heading[1].trim();
  const rest = md.slice(heading.index + heading[0].length);
  const nextHeadingIdx = rest.search(/^##\s*\[/m);
  const body = nextHeadingIdx >= 0 ? rest.slice(0, nextHeadingIdx) : rest;

  const headlineMatch = body.match(/^###\s+(.+)$/m);
  const headline = headlineMatch ? stripMarkdown(headlineMatch[1]) : `Version ${version}`;

  const bullets = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^-\s+(.+)$/); // top-level bullets only (no indentation)
    if (m) bullets.push(stripMarkdown(m[1]));
    if (bullets.length >= 6) break;
  }
  return { version, headline, bullets };
}

function getReleaseNotes() {
  try {
    const md = fs.readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf8");
    const parsed = parseChangelog(md);
    if (parsed && parsed.version) return parsed;
  } catch (_error) {
    // fall through to fallback
  }
  return { ...FALLBACK, bullets: FALLBACK.bullets.slice() };
}

module.exports = { getReleaseNotes };
