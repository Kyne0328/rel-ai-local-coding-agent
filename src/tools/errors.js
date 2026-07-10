function enhanceToolError(toolName, error) {
  const raw = error instanceof Error ? error.message : String(error);
  const append = (extra) => {
    const next = new Error(`${raw}\n\n${extra}`);
    if (error?.stack) next.stack = error.stack;
    return next;
  };
  return editErrorHint(toolName, raw, append)
    ?? patchErrorHint(toolName, raw, append, error)
    ?? clearFilesErrorHint(toolName, raw, append)
    ?? (error instanceof Error ? error : new Error(raw));
}

// Exact-edit failures for relai_replace / relai_edit. Returns an enhanced Error, or
// null when no hint applies (so the caller falls through to the next matcher).
function editErrorHint(toolName, raw, append) {
  if (toolName !== "relai_replace" && toolName !== "relai_edit") return null;
  if (/Invalid IPv6 URL|Invalid URL|ERR_INVALID_URL/i.test(raw)) {
    return append("Edit payload was rejected by a URL parser, likely on the client transport. Workarounds:\n  - relai_edit { path, content }                 // whole-file replace\n  - relai_edit { updateText: <unified diff> }    // patch-shaped change\n  - Split into multiple smaller relai_edit calls with shorter oldText/newText blocks");
  }
  if (/found 0 matches/.test(raw)) {
    return append("Fallback: call relai_read on the file to get current contents, then retry with exact current text. For complete rewrites use relai_write { stage: \"direct\", content }.");
  }
  if (/found \d+ matches/.test(raw)) {
    return append("Fallback: pass occurrence: N to target one match, or extend oldText with surrounding lines until it is unique.");
  }
  if (/exceeds .* bytes/i.test(raw)) {
    return append("Fallback: use relai_write { stage: \"direct\", content } for a whole-file replacement, or split the change into smaller exact replacements.");
  }
  return null;
}

// Patch-format failures. relai_edit routes updateText through the same patch engine,
// so it needs the same guidance as relai_apply_update.
function patchErrorHint(toolName, raw, append, error) {
  if (toolName !== "relai_apply_update" && toolName !== "relai_edit") return null;
  if (/corrupt patch|patch .* invalid|did not contain any valid|patch failed/i.test(raw)) {
    return append("Accepted patch formats:\n  1) Git unified diff:\n       --- a/path/to/file\n       +++ b/path/to/file\n       @@ -1,3 +1,3 @@\n       - old line\n       + new line\n  2) OpenAI patch format:\n       *** Begin Patch\n       *** Update File: path/to/file\n       @@\n       - old\n       + new\n       *** End Patch\nFor whole-file rewrites prefer relai_edit { path, content }.");
  }
  if (/context mismatch|delete mismatch|unsupported line/i.test(raw)) {
    return append("The OpenAI patch could not be matched against the current file contents. Re-read the file, regenerate the patch from current text, and make sure each changed block includes enough unchanged context lines.");
  }
  if (/Delete File.*not supported/i.test(raw)) {
    return error instanceof Error ? error : new Error(raw);
  }
  return null;
}

function clearFilesErrorHint(toolName, raw, append) {
  if (toolName === "relai_clear_files" && /blocked sensitive path|refuses non-file/i.test(raw)) {
    return append("Hard-boundary safety block. Accepted call shapes:\n  - { path: \"relative/file\" }\n  - { paths: [\"relative/file\", ...] }\nBoth are equivalent; only the file path itself is checked. Sensitive paths (.env, .ssh, credentials, .git) are always refused.");
  }
  return null;
}

module.exports = { enhanceToolError };
