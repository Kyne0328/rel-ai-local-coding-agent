const TOOL_INVOCATION_STATUS = Object.freeze({
  relai_work: ['Updating Rel.AI task…', 'Rel.AI task updated'],
  relai_snapshot: ['Scanning repository…', 'Repository scanned'],
  relai_read: ['Reading repository…', 'Repository read'],
  relai_search: ['Searching repository…', 'Repository searched'],
  relai_inspect: ['Inspecting code…', 'Code inspected'],
  relai_edit: ['Applying changes…', 'Changes applied'],
  relai_memory: ['Saving memory…', 'Memory updated'],
  relai_skill: ['Saving learned skill…', 'Learned skill saved'],
  relai_exec: ['Running command…', 'Command finished'],
  relai_process: ['Managing process…', 'Process updated'],
  relai_ui: ['Testing local UI…', 'Local UI tested'],
  relai_computer: ['Controlling computer…', 'Computer action finished'],
  relai_validate: ['Validating changes…', 'Validation finished'],
  relai_changes: ['Reviewing changes…', 'Changes reviewed'],
  relai_publish: ['Publishing changes…', 'Changes published']
});

function toolUiMetadata(name) {
  const status = TOOL_INVOCATION_STATUS[String(name || '')];
  if (!status) return undefined;
  return Object.freeze({
    'openai/toolInvocation/invoking': status[0],
    'openai/toolInvocation/invoked': status[1]
  });
}

export { toolUiMetadata };
