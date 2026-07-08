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

function replaceDelimited(text, marker) {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf(marker, index);
    if (start < 0) return out + text.slice(index);
    const end = text.indexOf(marker, start + marker.length);
    if (end < 0) return out + text.slice(index);
    out += text.slice(index, start) + text.slice(start + marker.length, end);
    index = end + marker.length;
  }
  return out;
}

function replaceMarkdownLinks(text) {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const labelStart = text.indexOf("[", index);
    if (labelStart < 0) return out + text.slice(index);
    const labelEnd = text.indexOf("]", labelStart + 1);
    const urlStart = labelEnd >= 0 ? text.indexOf("(", labelEnd + 1) : -1;
    const urlEnd = urlStart >= 0 ? text.indexOf(")", urlStart + 1) : -1;
    if (labelEnd < 0 || urlStart !== labelEnd + 1 || urlEnd < 0) {
      out += text.slice(index, labelStart + 1);
      index = labelStart + 1;
      continue;
    }
    out += text.slice(index, labelStart) + text.slice(labelStart + 1, labelEnd);
    index = urlEnd + 1;
  }
  return out;
}

function isWhitespaceOrEdge(text, index) {
  if (index < 0 || index >= text.length) return true;
  const ch = text[index];
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function stripBoundedUnderscores(text) {
  let out = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] === "_" && isWhitespaceOrEdge(text, index - 1)) {
      const end = text.indexOf("_", index + 1);
      if (end > index + 1 && isWhitespaceOrEdge(text, end + 1)) {
        out += text.slice(index + 1, end);
        index = end + 1;
        continue;
      }
    }
    out += text[index];
    index += 1;
  }
  return out;
}

// Strip the markdown that appears in CHANGELOG bullets so the dashboard shows plain
// readable text: bold/italic, inline code, and [text](link) -> text.
function stripMarkdown(text) {
  return stripBoundedUnderscores(
    replaceDelimited(
      replaceDelimited(
        replaceDelimited(
          replaceMarkdownLinks(String(text || "")),
          "`"
        ),
        "**"
      ),
      "*"
    )
  ).trim();
}

function parseHeading(line) {
  if (!line.startsWith("## [")) return null;
  const versionEnd = line.indexOf("]", 4);
  if (versionEnd < 0) return null;
  const version = line.slice(4, versionEnd).trim();
  let rest = line.slice(versionEnd + 1).trim();
  if (rest.startsWith("—") || rest.startsWith("–") || rest.startsWith("-")) rest = rest.slice(1).trim();
  return { version, date: rest };
}

function parseChangelog(md) {
  const lines = String(md || "").split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => parseHeading(line));
  if (headingIndex < 0) return null;
  const heading = parseHeading(lines[headingIndex]);
  const body = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## [")) break;
    body.push(lines[index]);
  }

  const headlineLine = body.find((line) => line.startsWith("### "));
  const headline = headlineLine ? stripMarkdown(headlineLine.slice(4)) : `Version ${heading.version}`;

  const bullets = [];
  for (const line of body) {
    if (!line.startsWith("- ")) continue;
    bullets.push(stripMarkdown(line.slice(2)));
    if (bullets.length >= 6) break;
  }
  return { version: heading.version, headline, bullets };
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
