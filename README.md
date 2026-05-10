# Rel.AI MCP

Rel.AI MCP is a local ChatGPT repository bridge. It intentionally exposes one reliable workflow for configured local workspaces:

```text
relai_repo_snapshot -> relai_read -> relai_write -> relai_verify -> relai_diff -> relai_reset
```

## MCP tools

| Tool | Purpose |
| --- | --- |
| `relai_repo_snapshot` | Return a filtered project snapshot, manifests, discovered commands, and context hints. |
| `relai_read` | Read focused files or directory summaries. |
| `relai_write` | Replace one complete file with corrected full-file content. This is the only normal edit path. |
| `relai_verify` | Run detected or requested verification commands. |
| `relai_browser` | Run a browser/UI check or fetch a route. |
| `relai_diff` | Review git status and diff. |
| `relai_reset` | Roll back requested local changes. |

Removed workflows are not part of the MCP anymore: unified patch application, generated patch scripts, ad-hoc shell tools, task runners, isolated worktree orchestration, multi-agent schedulers, approval-gated legacy flows, Docker runners, and PR/CI repair loops.

## Dashboard

The dashboard manages local bridge configuration, workspace settings, fast-task mode, workspace deletion, and connection details. It does not expose alternate edit workflows.

## Fast task mode

Each workspace can define fast-task behavior:

```json
{
  "fastTask": {
    "enabled": true,
    "preferChangedFiles": true,
    "skipIndexForSmallTasks": true,
    "maxIndexFiles": 750,
    "includeRoots": [],
    "excludePaths": [".git", "node_modules", "build", "dist", "coverage"]
  }
}
```

Use `.relaiignore` in a repo to add repo-specific AI-context exclusions.


## Optional ChatGPT request helper

The dashboard can generate a guarded userscript for ChatGPT Web and Android browsers with userscript support. It can highlight or auto-approve visible Rel.AI app/tool request dialogs only when explicitly enabled. See `docs/CHATGPT_REQUEST_HELPER.md`.
