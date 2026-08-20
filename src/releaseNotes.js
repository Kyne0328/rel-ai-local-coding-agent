import { packageMetadata, resolvePackagePath } from './packageMetadata.js';
import * as fs from "node:fs";

// Last-resort fallback if CHANGELOG.md cannot be read/parsed. Use the package
// version so the dashboard never renders a bare "v" (the packaged launcher hit this
// when CHANGELOG wasn't bundled).
const PKG_VERSION = readPackageVersion();
const FALLBACK = {
  version: PKG_VERSION,
  headline: "See CHANGELOG.md for the latest changes.",
  bullets: [],
  releases: []
};

function readPackageVersion() {
  try {
    return packageMetadata.version || "";
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] package version:', error);
    return "";
  }
}

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

function parseRelease(lines, startIndex, endIndex) {
  const heading = parseHeading(lines[startIndex]);
  if (!heading) return null;

  const sections = [];
  let section = null;
  const ungroupedBullets = [];
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const line = lines[index];
    if (line.startsWith("### ")) {
      section = { title: stripMarkdown(line.slice(4)), bullets: [] };
      sections.push(section);
      continue;
    }
    if (!line.startsWith("- ")) continue;
    const bullet = stripMarkdown(line.slice(2));
    if (!bullet) continue;
    if (section) section.bullets.push(bullet);
    else ungroupedBullets.push(bullet);
  }

  const normalizedSections = [
    ...(ungroupedBullets.length ? [{ title: "", bullets: ungroupedBullets }] : []),
    ...sections.filter((entry) => entry.title || entry.bullets.length)
  ];
  const bullets = normalizedSections.flatMap((entry) => entry.bullets);
  return {
    version: heading.version,
    date: heading.date,
    headline: sections[0]?.title || `Version ${heading.version}`,
    bullets: bullets.slice(0, 6),
    sections: normalizedSections
  };
}

function parseChangelog(md) {
  const lines = String(md || "").split(/\r?\n/);
  let startIndex = -1;
  let endIndex = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = parseHeading(lines[index]);
    if (!heading) continue;
    if (startIndex < 0) {
      if (heading.version === PKG_VERSION) startIndex = index;
      continue;
    }
    endIndex = index;
    break;
  }
  if (startIndex < 0) return null;

  const release = parseRelease(lines, startIndex, endIndex);
  if (!release) return null;
  return { ...release, releases: [release] };
}

function fallbackReleaseNotes() {
  return { ...FALLBACK, bullets: FALLBACK.bullets.slice() };
}

function getReleaseNotes() {
  try {
    const md = fs.readFileSync(resolvePackagePath('CHANGELOG.md'), "utf8");
    const parsed = parseChangelog(md);
    if (parsed?.version) return parsed;
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] release notes:', error);
  }
  return fallbackReleaseNotes();
}

export { getReleaseNotes };
