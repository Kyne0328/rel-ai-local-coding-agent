const PUBLIC_MCP_SERVER_INSTRUCTIONS = 'Start each objective with relai_work action begin and a configured workspace, then pass its work_id to later calls. Inspect relevant files before editing; use bounded reads and commands. Validate after changes. On edit failure, follow recovery guidance and retry; report unavailable only after a separate availability check fails. Never bypass approval, workspace, task, or destructive-operation safeguards. Report only checks actually run. Finish with relai_work action finish after review.';

export { PUBLIC_MCP_SERVER_INSTRUCTIONS };
