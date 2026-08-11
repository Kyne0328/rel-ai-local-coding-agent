const PUBLIC_MCP_SERVER_INSTRUCTIONS = 'Start each objective with relai_work action begin and pass its work_id to later calls. Inspect relevant files before editing; use bounded reads and commands. Validate after changes. Never bypass approval, workspace, task, or destructive-operation safeguards. Report only checks actually run. Finish with relai_validate action checks complete:true, or relai_work action finish after review.';

export { PUBLIC_MCP_SERVER_INSTRUCTIONS };
