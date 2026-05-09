const fs = require("node:fs");
const { readTextFileSafe, writeTextFileSafe, resolveSafePath, fileSha256 } = require("./safety");

function isPatchParserError(summary) {
  const text = `${summary && summary.stderr || ""}\n${summary && summary.stdout || ""}`.toLowerCase();
  return text.includes("patch with only garbage") ||
    text.includes("no valid patches") ||
    text.includes("corrupt patch") ||
    text.includes("unrecognized input") ||
    text.includes("hunk header") ||
    text.includes("malformed patch");
}

function applyLoosePatch(workspace, diff, options = {}) {
  const parsed = parseLoosePatch(diff);
  if (parsed.files.length === 0) {
    return failure("LOOSE_PATCH_NO_FILES", "The patch text did not contain recognizable file headers.", parsed);
  }

  const dryRun = Boolean(options.dryRun);
  const planned = [];
  const failures = [];

  for (const filePatch of parsed.files) {
    try {
      const safe = resolveSafePath(workspace.path, filePatch.path);
      if (!fs.existsSync(safe.absolutePath)) {
        failures.push({ path: filePatch.path, reason: "file does not exist" });
        continue;
      }
      const oldContent = readTextFileSafe(workspace.path, safe.relativePath);
      const oldSha256 = fileSha256(workspace.path, safe.relativePath);
      let nextContent = oldContent;
      const hunkResults = [];

      for (let i = 0; i < filePatch.hunks.length; i += 1) {
        const hunk = filePatch.hunks[i];
        const applied = applyLooseHunk(nextContent, hunk);
        if (!applied.ok) {
          failures.push({ path: filePatch.path, hunk: i + 1, header: hunk.header, reason: applied.reason });
          break;
        }
        nextContent = applied.content;
        hunkResults.push({ hunk: i + 1, strategy: applied.strategy, line: applied.line });
      }

      if (!failures.some((item) => item.path === filePatch.path)) {
        planned.push({ path: safe.relativePath, oldContent, nextContent, oldSha256, hunkResults });
      }
    } catch (error) {
      failures.push({ path: filePatch.path, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  if (failures.length) {
    return {
      ok: false,
      fallbackAttempted: true,
      fallbackType: "loose_context_patch",
      code: "LOOSE_PATCH_FAILED",
      message: "The unified diff was malformed, and the deterministic fallback could not apply it safely. Use relai_write with replaceExact/replaceBetween edits instead of retrying relai_apply_patch.",
      failures,
      recommendedTool: "relai_write",
      recommendedFlow: ["relai_read", "relai_write", "relai_verify", "relai_diff"]
    };
  }

  const changed = planned.filter((item) => item.nextContent !== item.oldContent);
  if (!dryRun) {
    for (const item of changed) {
      writeTextFileSafe(workspace.path, item.path, item.nextContent, { expectedSha256: item.oldSha256 });
    }
  }

  return {
    ok: true,
    dryRun,
    fallbackApplied: true,
    fallbackType: "loose_context_patch",
    message: dryRun
      ? "Malformed unified diff parsed as a loose context patch. Dry run passed; no files changed."
      : "Malformed unified diff was applied through deterministic loose-context editing.",
    changedFiles: changed.map((item) => item.path),
    files: planned.map((item) => ({
      path: item.path,
      changed: item.nextContent !== item.oldContent,
      oldSha256: item.oldSha256,
      hunkResults: item.hunkResults
    })),
    warning: "relai_apply_patch accepted a malformed legacy patch for compatibility. Prefer relai_write for future edits."
  };
}

function failure(code, message, parsed) {
  return { ok: false, fallbackAttempted: true, fallbackType: "loose_context_patch", code, message, parsedFiles: parsed.files.length, recommendedTool: "relai_write" };
}

function parseLoosePatch(diff) {
  const lines = String(diff || "").replace(/\r\n/g, "\n").split("\n");
  const files = [];
  let current = null;
  let pendingOldPath = null;
  let currentHunk = null;

  function finishHunk() {
    if (current && currentHunk) {
      current.hunks.push(currentHunk);
      currentHunk = null;
    }
  }

  function finishFile() {
    finishHunk();
    if (current && current.path && current.hunks.length) files.push(current);
    current = null;
  }

  function startFile(filePath) {
    finishFile();
    current = { path: cleanDiffPath(filePath), hunks: [] };
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, "");
    const diffMatch = /^diff --git\s+a\/(.+?)\s+b\/(.+)$/.exec(line);
    if (diffMatch) {
      startFile(diffMatch[2]);
      pendingOldPath = null;
      continue;
    }
    if (line.startsWith("--- ")) {
      pendingOldPath = line.slice(4).trim().split(/\s+/)[0];
      continue;
    }
    if (line.startsWith("+++ ")) {
      const nextPath = line.slice(4).trim().split(/\s+/)[0];
      if (!current || current.path !== cleanDiffPath(nextPath)) startFile(nextPath);
      pendingOldPath = null;
      continue;
    }
    if (!current && pendingOldPath) continue;
    if (!current) continue;

    if (line.startsWith("@@")) {
      finishHunk();
      currentHunk = { header: cleanHunkHeader(line), lines: [] };
      continue;
    }

    if (!currentHunk) continue;
    if (line.startsWith("index ") || line.startsWith("new file mode ") || line.startsWith("deleted file mode ")) continue;
    currentHunk.lines.push(rawLine);
  }

  finishFile();
  return { files };
}

function cleanDiffPath(value) {
  let out = String(value || "").trim();
  if (out === "/dev/null") return out;
  if (out.startsWith("a/") || out.startsWith("b/")) out = out.slice(2);
  return out.replace(/\\/g, "/");
}

function cleanHunkHeader(line) {
  return String(line || "").replace(/^@@\s*/, "").replace(/\s*@@.*$/, "").trim();
}

function applyLooseHunk(content, hunk) {
  const oldLines = [];
  const newLines = [];
  let sawChange = false;

  for (const raw of hunk.lines) {
    if (raw.startsWith("+++") || raw.startsWith("---")) continue;
    if (raw.startsWith("+")) {
      newLines.push(raw.slice(1));
      sawChange = true;
    } else if (raw.startsWith("-")) {
      oldLines.push(raw.slice(1));
      sawChange = true;
    } else if (raw.startsWith(" ")) {
      const value = raw.slice(1);
      oldLines.push(value);
      newLines.push(value);
    } else if (raw.trim() !== "") {
      oldLines.push(raw);
      newLines.push(raw);
    }
  }

  if (!sawChange) return { ok: false, reason: "hunk contains no additions or removals" };
  if (oldLines.length === 0 && hunk.header) {
    return insertAfterHeader(content, hunk.header, newLines);
  }

  const lineInfo = splitLines(content);
  const matches = findLooseSequence(lineInfo.lines, oldLines);
  if (matches.length === 1) {
    const start = matches[0];
    const before = lineInfo.lines.slice(0, start);
    const after = lineInfo.lines.slice(start + oldLines.length);
    return {
      ok: true,
      strategy: "fuzzy-line-sequence",
      line: start + 1,
      content: joinLines([...before, ...preserveIndent(oldLines, newLines, lineInfo.lines.slice(start, start + oldLines.length)), ...after], lineInfo.trailingNewline)
    };
  }
  if (matches.length > 1) return { ok: false, reason: `hunk context is ambiguous: ${matches.length} matches` };

  if (hunk.header) {
    const headerMatches = findHeaderLines(lineInfo.lines, hunk.header);
    if (headerMatches.length === 1) {
      const at = headerMatches[0];
      return insertNearHeader(lineInfo, at, oldLines, newLines);
    }
    if (headerMatches.length > 1) return { ok: false, reason: `hunk header is ambiguous: ${headerMatches.length} matches` };
  }

  return { ok: false, reason: "hunk context was not found" };
}

function insertAfterHeader(content, header, newLines) {
  const lineInfo = splitLines(content);
  const matches = findHeaderLines(lineInfo.lines, header);
  if (matches.length !== 1) return { ok: false, reason: matches.length ? `hunk header is ambiguous: ${matches.length} matches` : "hunk header was not found" };
  const at = matches[0] + 1;
  const indent = leadingWhitespace(lineInfo.lines[matches[0]] || "");
  const inserted = newLines.map((line) => line.trim() ? indent + line.trimStart() : line);
  return { ok: true, strategy: "insert-after-header", line: at, content: joinLines([...lineInfo.lines.slice(0, at), ...inserted, ...lineInfo.lines.slice(at)], lineInfo.trailingNewline) };
}

function insertNearHeader(lineInfo, headerIndex, oldLines, newLines) {
  const windowStart = headerIndex;
  const windowEnd = Math.min(lineInfo.lines.length, headerIndex + 40);
  const windowLines = lineInfo.lines.slice(windowStart, windowEnd);
  const matches = findLooseSequence(windowLines, oldLines);
  if (matches.length === 1) {
    const start = windowStart + matches[0];
    const before = lineInfo.lines.slice(0, start);
    const after = lineInfo.lines.slice(start + oldLines.length);
    return { ok: true, strategy: "header-window-sequence", line: start + 1, content: joinLines([...before, ...preserveIndent(oldLines, newLines, lineInfo.lines.slice(start, start + oldLines.length)), ...after], lineInfo.trailingNewline) };
  }
  return { ok: false, reason: matches.length > 1 ? `header window context is ambiguous: ${matches.length} matches` : "header was found, but hunk body did not match nearby" };
}

function splitLines(content) {
  const trailingNewline = String(content).endsWith("\n");
  const lines = String(content).replace(/\r\n/g, "\n").split("\n");
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

function joinLines(lines, trailingNewline) {
  return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
}

function findLooseSequence(lines, wanted) {
  const filteredWanted = wanted.filter((line) => line.trim() !== "");
  if (filteredWanted.length === 0) return [];
  const matches = [];
  for (let i = 0; i <= lines.length - filteredWanted.length; i += 1) {
    let ok = true;
    for (let j = 0; j < filteredWanted.length; j += 1) {
      if (normalizeLine(lines[i + j]) !== normalizeLine(filteredWanted[j])) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(i);
  }
  return matches;
}

function findHeaderLines(lines, header) {
  const needle = normalizeLine(header);
  if (!needle) return [];
  const matches = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (normalizeLine(lines[i]).includes(needle)) matches.push(i);
  }
  return matches;
}

function preserveIndent(oldLines, newLines, actualOldLines) {
  const defaultIndent = firstUsefulIndent(actualOldLines) || firstUsefulIndent(oldLines) || "";
  const indentByNorm = new Map();
  for (let i = 0; i < oldLines.length; i += 1) {
    const norm = normalizeLine(oldLines[i]);
    if (norm && actualOldLines[i]) indentByNorm.set(norm, leadingWhitespace(actualOldLines[i]));
  }
  return newLines.map((line) => {
    if (!line.trim()) return line;
    const norm = normalizeLine(line);
    const indent = indentByNorm.get(norm) || defaultIndent;
    return indent + line.trimStart();
  });
}

function firstUsefulIndent(lines) {
  const found = (lines || []).find((line) => String(line || "").trim());
  return found ? leadingWhitespace(found) : "";
}

function leadingWhitespace(line) {
  const match = /^\s*/.exec(String(line || ""));
  return match ? match[0] : "";
}

function normalizeLine(line) {
  return String(line || "").trim().replace(/\s+/g, " ");
}

module.exports = { applyLoosePatch, isPatchParserError, parseLoosePatch };
