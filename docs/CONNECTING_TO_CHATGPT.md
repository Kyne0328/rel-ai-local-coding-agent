# Connecting to ChatGPT Business Developer Mode

This project is a local MCP stdio server.

Use an MCP connector configuration equivalent to:

```json
{
  "mcpServers": {
    "rel-ai-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/rel-ai-mcp/bin/rel-ai-mcp.js"],
      "env": {
        "REL_AI_MCP_CONFIG": "/absolute/path/to/config.json"
      }
    }
  }
}
```

The server writes only JSON-RPC messages to stdout. Logs go to stderr.

After connecting, ask ChatGPT something like:

```text
Use rel-ai-mcp. In workspace myapp, inspect the tree, read the relevant files, create a feature branch, apply the smallest safe patch, run the unit test command, fix failures if needed, commit, push, and create a draft PR.
```

Recommended ChatGPT usage policy:

- Always call `relai_git_status` first.
- Prefer `relai_workspace_tree` before reading files.
- Use `relai_read_files` for exact files only.
- Use `relai_apply_patch` with `dryRun: true` before a real apply.
- Use `relai_run_test` only with configured test command keys.
- Use feature branches for commits.
- Keep PRs draft until reviewed.
