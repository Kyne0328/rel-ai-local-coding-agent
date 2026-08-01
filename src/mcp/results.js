const DEFAULT_MAX_TOOL_RESULT_BYTES = 512 * 1024;
const DEFAULT_MAX_TOOL_TEXT_BYTES = 8 * 1024;
const MAX_TOOL_RESULT_BYTES = Number(
  process.env.REL_AI_MCP_MAX_TOOL_RESULT_BYTES
  || process.env.REL_AI_MCP_MAX_TOOL_RESULT_CHARS
  || DEFAULT_MAX_TOOL_RESULT_BYTES
);
const MAX_TOOL_TEXT_BYTES = Number(process.env.REL_AI_MCP_MAX_TOOL_TEXT_BYTES || DEFAULT_MAX_TOOL_TEXT_BYTES);

function toolResult(payload, isError) {
  const serialized = JSON.stringify(payload);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  const structuredContent = bytes > MAX_TOOL_RESULT_BYTES
    ? compactToolResult(payload, bytes)
    : payload;
  const text = conciseToolResultText(payload, {
    isError: Boolean(isError),
    originalBytes: bytes,
    structuredTruncated: bytes > MAX_TOOL_RESULT_BYTES
  });
  return {
    content: [{ type: 'text', text: truncateUtf8Head(text, MAX_TOOL_TEXT_BYTES) }],
    structuredContent,
    isError: Boolean(isError)
  };
}

function conciseToolResultText(payload, options = {}) {
  if (!payload || typeof payload !== 'object') {
    return boundedText(String(payload ?? ''), MAX_TOOL_TEXT_BYTES) || 'Rel.AI returned no structured result.';
  }
  const success = payload.ok !== false && options.isError !== true;
  const lines = [success ? 'Rel.AI operation succeeded.' : 'Rel.AI operation failed.'];
  appendField(lines, 'Workspace', scalarText(payload.workspace));
  appendField(lines, 'Work session', scalarText(payload.work_id));
  appendField(lines, 'Process', scalarText(payload.processId));
  appendField(lines, 'Status', scalarText(payload.status || payload.validationStatus));
  appendField(lines, 'Summary', displayText(payload.summary, 1800));
  appendField(lines, 'Message', displayText(payload.message, 1800));
  appendField(lines, 'Error', displayText(payload.error, 2400));
  appendField(lines, 'Next action', displayText(payload.nextAction, 1600));
  appendField(lines, 'Stdout tail', tailText(payload.stdout, 1000));
  appendField(lines, 'Stderr tail', tailText(payload.stderr, 1600));
  if (options.structuredTruncated) {
    lines.push(`Structured result compacted from ${Number(options.originalBytes || 0)} bytes. Re-call with narrower limits for complete bounded data.`);
  }
  return lines.join('\n');
}

function appendField(lines, label, value) {
  if (value) lines.push(`${label}: ${value}`);
}

function scalarText(value) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    return String(value.alias || value.path || value.id || value.name || '').trim() || undefined;
  }
  return undefined;
}

function displayText(value, maxChars) {
  if (typeof value === 'string') return boundedText(value, maxChars);
  if (value == null) return undefined;
  try {
    return boundedText(JSON.stringify(value), maxChars);
  } catch {
    return undefined;
  }
}

function truncateUtf8Head(text, maxBytes) {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_TOOL_TEXT_BYTES;
  const buffer = Buffer.from(String(text), 'utf8');
  if (buffer.length <= limit) return String(text);
  const marker = '\n[rel-ai-mcp text summary truncated]';
  const allowed = Math.max(0, limit - Buffer.byteLength(marker, 'utf8'));
  return `${buffer.subarray(0, allowed).toString('utf8').replace(/\uFFFD+$/u, '')}${marker}`;
}

function compactToolResult(payload, originalBytes) {
  if (!payload || typeof payload !== 'object') return { ok: false, truncated: true, originalBytes };
  const compact = {
    ok: payload.ok !== false,
    truncated: true,
    originalBytes,
    workspace: payload.workspace || null,
    work_id: payload.work_id || null,
    processId: payload.processId,
    status: payload.status,
    duplicate: payload.duplicate,
    mode: payload.mode,
    check: payload.check,
    exitCode: payload.exitCode,
    durationMs: payload.durationMs,
    diagnosticCount: payload.diagnosticCount,
    validationStatus: payload.validationStatus,
    completionKnown: payload.completionKnown,
    message: displayText(payload.message, 2000) || 'Result was compacted. Re-call with narrower limits.',
    error: displayText(payload.error, 4000),
    errorCode: payload.errorCode,
    level: payload.level,
    summary: displayText(payload.summary, 2000),
    nextAction: displayText(payload.nextAction, 2000),
    stdout: tailText(payload.stdout, 2000),
    stderr: tailText(payload.stderr, 4000),
    results: compactDiagnosticResults(payload.results)
  };
  return Object.fromEntries(Object.entries(compact).filter(([, value]) => value != null));
}

function compactDiagnosticResults(results) {
  if (!Array.isArray(results) || results.length === 0) return undefined;
  return results.slice(0, 5).map(item => Object.fromEntries(Object.entries({
    command: boundedText(item?.command, 1000),
    ok: item?.ok !== false,
    exitCode: item?.exitCode,
    timedOut: item?.timedOut === true,
    signal: item?.signal,
    stdout: tailText(item?.stdout, 2000),
    stderr: tailText(item?.stderr, 4000)
  }).filter(([, value]) => value != null)));
}

function boundedText(value, maxChars) {
  if (typeof value !== 'string' || !value) return undefined;
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[truncated]`;
}

function tailText(value, maxChars) {
  if (typeof value !== 'string' || !value) return undefined;
  return value.length <= maxChars ? value : `[kept last ${maxChars} chars]\n${value.slice(-maxChars)}`;
}

export { conciseToolResultText, toolResult };
