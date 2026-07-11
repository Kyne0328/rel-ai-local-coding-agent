function enhanceToolError(toolName, error) {
  const raw = error instanceof Error ? error.message : String(error);
  const append = (extra) => {
    const next = new Error(`${raw}\n\n${extra}`);
    if (error?.stack) next.stack = error.stack;
    return next;
  };
  return editErrorHint(toolName, raw, append)
    ?? patchErrorHint(toolName, raw, append, error)
    ?? (error instanceof Error ? error : new Error(raw));
}

function editErrorHint(toolName, raw, append) {
  if (toolName !== 'relai_replace' && toolName !== 'relai_edit') return null;
  if (/Invalid IPv6 URL|Invalid URL|ERR_INVALID_URL/i.test(raw)) {
    return append('Edit payload was rejected by a URL parser, likely on the client transport. Use relai_edit with content, updateText, or smaller oldText/newText blocks.');
  }
  if (/found 0 matches/.test(raw)) {
    return append('Call relai_read on the file, then retry with exact current text. Use relai_edit with content only for a complete rewrite.');
  }
  if (/found \d+ matches/.test(raw)) {
    return append('Pass occurrence: N to target one match, or extend oldText with surrounding lines until it is unique.');
  }
  if (/exceeds .* bytes/i.test(raw)) {
    return append('Use relai_edit with content for a complete replacement, or split the change into smaller exact replacements.');
  }
  return null;
}

function patchErrorHint(toolName, raw, append, error) {
  if (toolName !== 'relai_edit') return null;
  if (/corrupt patch|patch .* invalid|did not contain any valid|patch failed/i.test(raw)) {
    return append("Accepted updateText formats are Git unified diff and structured OpenAI patch format. Re-read the current files before regenerating the patch.");
  }
  if (/context mismatch|delete mismatch|unsupported line/i.test(raw)) {
    return append('The patch did not match current file contents. Re-read the file and regenerate the patch with sufficient unchanged context.');
  }
  if (/Delete File.*not supported/i.test(raw)) {
    return error instanceof Error ? error : new Error(raw);
  }
  return null;
}

module.exports = { enhanceToolError };
