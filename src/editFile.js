const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  resolveSafePath,
  readTextFileSafe,
  writeTextFileSafe,
  fileSha256,
  looksBinary
} = require("./safety");

const MAX_EDIT_OPERATIONS = 100;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_PREVIEW_BYTES = 200000;

function editFile(workspace, args = {}) {
  const relativePath = String(args.path || "").trim();
  if (!relativePath) throw new Error("path is required.");
  const edits = Array.isArray(args.edits) ? args.edits : [];
  if (edits.length === 0) throw new Error("edits must contain at least one edit operation.");
  if (edits.length > MAX_EDIT_OPERATIONS) throw new Error(`Too many edit operations: ${edits.length}. Maximum is ${MAX_EDIT_OPERATIONS}.`);

  const safe = resolveSafePath(workspace.path, relativePath);
  const oldSha256 = fileSha256(workspace.path, safe.relativePath);
  if (args.expectedSha256 && oldSha256 !== args.expectedSha256) {
    throw new Error(`SHA mismatch for ${safe.relativePath}. Expected ${args.expectedSha256}, got ${oldSha256 || "missing"}.`);
  }

  const oldContent = readTextFileSafe(workspace.path, safe.relativePath);
  let newContent = oldContent;
  const operationResults = [];

  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index] || {};
    const result = applyOperation(newContent, edit, index);
    newContent = result.content;
    operationResults.push(result.summary);
  }

  if (newContent === oldContent) {
    return {
      ok: true,
      dryRun: Boolean(args.dryRun),
      path: safe.relativePath,
      changed: false,
      oldSha256,
      newSha256: oldSha256,
      operations: operationResults,
      diff: ""
    };
  }

  const outputBytes = Buffer.byteLength(newContent, "utf8");
  const maxOutputBytes = Math.max(1, Number(args.maxChangedBytes || DEFAULT_MAX_OUTPUT_BYTES));
  if (outputBytes > maxOutputBytes) {
    throw new Error(`Edited content for ${safe.relativePath} is ${outputBytes} bytes, exceeding maxChangedBytes limit ${maxOutputBytes}.`);
  }
  if (looksBinary(Buffer.from(newContent, "utf8"))) throw new Error("Refusing to write binary-looking content.");

  const diff = generateUnifiedDiff(safe.relativePath, oldContent, newContent, {
    maxPreviewBytes: args.maxPreviewBytes || DEFAULT_MAX_PREVIEW_BYTES
  });

  if (args.dryRun) {
    return {
      ok: true,
      dryRun: true,
      path: safe.relativePath,
      changed: true,
      oldSha256,
      newSha256: sha256Text(newContent),
      bytes: outputBytes,
      operations: operationResults,
      diff
    };
  }

  const write = writeTextFileSafe(workspace.path, safe.relativePath, newContent, { expectedSha256: oldSha256 });
  return {
    ok: true,
    dryRun: false,
    path: safe.relativePath,
    changed: true,
    oldSha256,
    newSha256: write.sha256,
    bytes: write.bytes,
    operations: operationResults,
    diff
  };
}

function applyOperation(content, edit, index) {
  const type = String(edit.type || "").trim();
  switch (type) {
    case "replace_exact":
      return replaceExact(content, edit, index);
    case "delete_exact":
      return replaceExact(content, { ...edit, new: "" }, index);
    case "insert_before":
      return insertRelative(content, edit, index, "before");
    case "insert_after":
      return insertRelative(content, edit, index, "after");
    default:
      throw new Error(`Unsupported edit operation at index ${index}: ${type || "<missing>"}. Supported: replace_exact, delete_exact, insert_before, insert_after.`);
  }
}

function replaceExact(content, edit, index) {
  const oldText = requiredString(edit.old ?? edit.text, `edits[${index}].old`);
  const newText = String(edit.new ?? "");
  const matches = findAll(content, oldText);
  const selected = selectMatches(matches, edit, index, "replace_exact");
  let next = content;
  for (let i = selected.length - 1; i >= 0; i -= 1) {
    const pos = selected[i];
    next = next.slice(0, pos) + newText + next.slice(pos + oldText.length);
  }
  return {
    content: next,
    summary: {
      index,
      type: edit.new === "" && edit.type === "delete_exact" ? "delete_exact" : "replace_exact",
      matches: matches.length,
      applied: selected.length
    }
  };
}

function insertRelative(content, edit, index, where) {
  const anchor = requiredString(edit.anchor, `edits[${index}].anchor`);
  const text = requiredString(edit.text, `edits[${index}].text`);
  const matches = findAll(content, anchor);
  const selected = selectMatches(matches, edit, index, `insert_${where}`);
  let next = content;
  for (let i = selected.length - 1; i >= 0; i -= 1) {
    const pos = where === "before" ? selected[i] : selected[i] + anchor.length;
    next = next.slice(0, pos) + text + next.slice(pos);
  }
  return {
    content: next,
    summary: { index, type: `insert_${where}`, matches: matches.length, applied: selected.length }
  };
}

function selectMatches(matches, edit, index, type) {
  if (matches.length === 0) {
    throw new Error(`${type} at edits[${index}] found no matches.`);
  }

  if (edit.occurrence != null) {
    const occurrence = Number(edit.occurrence);
    if (!Number.isInteger(occurrence) || occurrence < 1) throw new Error(`edits[${index}].occurrence must be a 1-based integer.`);
    if (occurrence > matches.length) throw new Error(`${type} at edits[${index}] requested occurrence ${occurrence}, but only ${matches.length} match(es) exist.`);
    if (edit.count != null && Number(edit.count) !== 1) throw new Error(`edits[${index}] cannot use occurrence with count other than 1.`);
    return [matches[occurrence - 1]];
  }

  if (edit.count != null) {
    const count = Number(edit.count);
    if (!Number.isInteger(count) || count < 0) throw new Error(`edits[${index}].count must be a non-negative integer.`);
    if (count !== matches.length) throw new Error(`${type} at edits[${index}] expected ${count} match(es), found ${matches.length}. Use occurrence for one specific match.`);
    return matches;
  }

  if (matches.length !== 1) {
    throw new Error(`${type} at edits[${index}] is ambiguous: found ${matches.length} matches. Provide count or occurrence.`);
  }
  return matches;
}

function findAll(content, needle) {
  if (needle === "") throw new Error("Search text cannot be empty.");
  const positions = [];
  let offset = 0;
  while (offset <= content.length) {
    const found = content.indexOf(needle, offset);
    if (found === -1) break;
    positions.push(found);
    offset = found + Math.max(needle.length, 1);
  }
  return positions;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function generateUnifiedDiff(relativePath, oldContent, newContent, options = {}) {
  const maxPreviewBytes = Math.max(1, Number(options.maxPreviewBytes || DEFAULT_MAX_PREVIEW_BYTES));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relai-edit-"));
  try {
    const oldPath = path.join(tmp, "old");
    const newPath = path.join(tmp, "new");
    fs.writeFileSync(oldPath, oldContent, "utf8");
    fs.writeFileSync(newPath, newContent, "utf8");
    let diff = "";
    try {
      diff = execFileSync("git", ["diff", "--no-index", "--", oldPath, newPath], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    } catch (error) {
      diff = error && error.stdout ? String(error.stdout) : "";
    }
    diff = normalizeNoIndexDiff(diff, relativePath);
    if (Buffer.byteLength(diff, "utf8") > maxPreviewBytes) {
      return diff.slice(0, maxPreviewBytes) + `\n[rel-ai-mcp diff preview truncated at ${maxPreviewBytes} bytes]`;
    }
    return diff;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_error) {}
  }
}

function normalizeNoIndexDiff(diff, relativePath) {
  const safePath = String(relativePath || "file").replace(/\\/g, "/");
  return String(diff || "")
    .replace(/^diff --git a\/.*old b\/.*new/m, `diff --git a/${safePath} b/${safePath}`)
    .replace(/^--- .*old/m, `--- a/${safePath}`)
    .replace(/^\+\+\+ .*new/m, `+++ b/${safePath}`);
}

function sha256Text(text) {
  return require("node:crypto").createHash("sha256").update(String(text), "utf8").digest("hex");
}

module.exports = { editFile };
