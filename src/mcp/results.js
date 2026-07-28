

const DEFAULT_MAX_TOOL_RESULT_BYTES = 512 * 1024;
const MAX_TOOL_RESULT_BYTES = Number(process.env.REL_AI_MCP_MAX_TOOL_RESULT_BYTES || process.env.REL_AI_MCP_MAX_TOOL_RESULT_CHARS || DEFAULT_MAX_TOOL_RESULT_BYTES);

function toolResult(payload, isError) {
  const text = JSON.stringify(payload, null, 2);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_TOOL_RESULT_BYTES) {
    return {
      content: [{ type: 'text', text: `${truncateUtf8Head(text, MAX_TOOL_RESULT_BYTES)}\n\n[rel-ai-mcp truncated tool result: ${bytes} bytes total]` }],
      structuredContent: compactToolResult(payload, bytes),
      isError: Boolean(isError)
    };
  }
  return { content: [{ type: 'text', text }], structuredContent: payload, isError: Boolean(isError) };
}

function truncateUtf8Head(text, maxBytes) {
  return Buffer.from(String(text), 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/u, '');
}

function compactToolResult(payload, originalBytes) {
  if (!payload || typeof payload !== 'object') return { ok: false, truncated: true, originalBytes };
  const compact = {
    ok: payload.ok !== false,
    truncated: true,
    originalBytes,
    message: boundedText(payload.message, 2000) || 'Result was truncated. Re-call with narrower limits.',
    workspace: payload.workspace || null,
    task_id: payload.task_id || payload.taskId || null,
    error: boundedText(payload.error, 4000),
    errorCode: payload.errorCode,
    level: payload.level,
    validationStatus: payload.validationStatus,
    completionKnown: payload.completionKnown,
    summary: boundedText(payload.summary, 2000),
    nextAction: boundedText(payload.nextAction, 2000),
    results: compactDiagnosticResults(payload.results),
    keys: Object.keys(payload).slice(0, 50)
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

export { toolResult };
