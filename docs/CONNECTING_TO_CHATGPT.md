# Connecting to ChatGPT

Rel.AI MCP exposes a small local-repo bridge to ChatGPT. In normal mode, ChatGPT sees one reliable workflow:

- `relai_repo_snapshot`
- `relai_read`
- `relai_write`
- `relai_replace`
- `relai_clear_files`
- `relai_run_checks`
- `relai_browser`
- `relai_diff`
- `relai_restore_changes`

Use `relai_repo_snapshot` to inspect a configured workspace, `relai_read` to load exact files, `relai_replace` for localized exact edits, `relai_write` for complete file replacement, `relai_clear_files` for obsolete files, `relai_run_checks` to run validation, and `relai_diff` to review the result.

Legacy update, local, command-runner, task-runner, and multi-agent tools are debug/internal tools. They are hidden from normal ChatGPT mode so the connector does not fall back into unreliable generated scripts, Python one-liners, or malformed unified diffs.


Maintained by [@Kyne0328](https://github.com/Kyne0328).
