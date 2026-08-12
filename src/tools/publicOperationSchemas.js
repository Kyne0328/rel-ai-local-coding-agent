function publicExecInputSchema(inputSchema) {
  const properties = inputSchema.properties || {};
  const describe = (name, description) => ({ ...properties[name], description });
  return {
    ...inputSchema,
    description: 'Choose one mode. Prefer direct executable + argv mode by default; use command only for deliberate shell parsing.',
    properties: {
      ...properties,
      command: describe('command', 'Shell command. Use only for shell syntax. Do not embed JavaScript, Python, JSON, patches, or multiline scripts.'),
      executable: describe('executable', 'Executable launched with shell:false; preferred for structured arguments.'),
      argv: describe('argv', 'Arguments passed without shell parsing; keep each logical argument separate.'),
      input: describe('input', 'Literal stdin for multiline scripts or structured text; preserves quote-sensitive content.'),
      cwd: describe('cwd', 'Optional workspace-relative working directory.'),
      env: describe('env', 'Optional environment variables supplied directly to the child process.'),
      timeoutMs: describe('timeoutMs', 'Maximum operation runtime in milliseconds.'),
      maxOutputBytes: describe('maxOutputBytes', 'Maximum captured stdout/stderr bytes before output is truncated.')
    }
  };
}

function publicEditInputSchema(inputSchema, maxBatchEdits) {
  const { oneOf: _oneOf, ...structuralSchema } = inputSchema;
  const properties = inputSchema.properties || {};
  const describe = (name, description) => ({ ...properties[name], description });
  return {
    ...structuralSchema,
    description: 'Choose one primary form. Rel.AI validates the selected form before touching the workspace.',
    properties: {
      ...properties,
      workspace: describe('workspace', 'Optional workspace ownership assertion. The work_id already identifies the bound workspace.'),
      path: describe('path', 'Workspace-relative target path. Required for full-file content and exact replacement forms.'),
      oldText: describe('oldText', 'Exact non-empty current text to replace. Pair with newText.'),
      newText: describe('newText', 'Replacement text paired with oldText. An empty string deletes the matched text.'),
      occurrence: describe('occurrence', 'One-based occurrence to replace when oldText is not unique.'),
      replacements: describe('replacements', 'Several exact oldText/newText replacements in one file.'),
      content: describe('content', 'Complete replacement content for one file. Use with path; an empty string creates an empty file.'),
      expectedSha256: describe('expectedSha256', 'Optional stale-write guard for direct, staged, batch, and environment edits.'),
      updateText: describe('updateText', 'Git unified diff or structured OpenAI patch text for patch-shaped changes.'),
      envAction: describe('envAction', 'Secret-safe environment operation: list, set, remove, or compare.'),
      key: describe('key', 'Environment key used by envAction set or remove.'),
      value: describe('value', 'Environment value used by envAction set. Values are never returned.'),
      templatePath: describe('templatePath', 'Public environment template used by envAction compare.'),
      edits: describe('edits', `Atomic structured batch of up to ${maxBatchEdits} file edits.`),
      runChecks: describe('runChecks', 'Run detected validation checks after a successful edit.'),
      level: describe('level', 'Validation level used when runChecks is true.'),
      returnDiff: describe('returnDiff', 'Return a bounded diff after a successful edit.'),
      dryRun: describe('dryRun', 'Validate and preview the edit without changing files.'),
      stage: describe('stage', 'Chunked content or updateText lifecycle: start, append, commit, or abort.'),
      writeId: describe('writeId', 'Opaque staged-write ID returned by stage start.')
    }
  };
}

export { publicEditInputSchema, publicExecInputSchema };
