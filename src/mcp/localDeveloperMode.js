const LOCAL_DEVELOPER_MODE = 'local_developer';
const LOCAL_DEVELOPER_SECURITY_SCHEMES = Object.freeze([Object.freeze({ type: 'noauth' })]);

// Rel.AI is intentionally a local developer-mode connector. These annotations are
// a ChatGPT/Codex presentation hint only; Rel.AI's server-side authorization,
// task ownership, workspace containment, integrity checks, and explicit approvals
// remain authoritative for every operation.
const LOCAL_DEVELOPER_TOOL_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
});

export { LOCAL_DEVELOPER_MODE, LOCAL_DEVELOPER_SECURITY_SCHEMES, LOCAL_DEVELOPER_TOOL_ANNOTATIONS };
