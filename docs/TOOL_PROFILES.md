# Rel.AI Tool Profiles

Rel.AI uses a hard-cutover public tool surface. Only two profiles are supported:

| Profile | Public tools | Intended use |
| --- | ---: | --- |
| `compact` | 12 | Default complete capability-oriented surface. |
| `core` | 7 | Token-sensitive repository inspection, editing, execution, and validation. |

Omitting `toolProfile` selects `compact`.

```json
{
  "toolProfile": "core"
}
```

The `core` profile exposes:

```text
relai_work
relai_read
relai_search
relai_inspect
relai_edit
relai_exec
relai_validate
```

Persistent processes, snapshots, recovery/reset, worktrees, and publishing require `compact`.

## Hard-cutover behavior

The former 30 direct-operation tools are not a selectable or callable public surface. Redundant aliases such as `full` and transitional profiles such as `legacy` are rejected during configuration and discovery. Internal operation definitions remain private implementation details behind the consolidated action tools.

Examples:

- `relai_begin_work` is replaced by `relai_work` action `begin`.
- `relai_run_checks` is replaced by `relai_validate` action `checks`.
- `relai_process_start` is replaced by `relai_process` action `start`.
- `relai_diff` is replaced by `relai_changes` action `diff`.
- `relai_git_push` is replaced by `relai_publish` action `push`.

Old direct names return an unknown-tool error instead of being silently routed. Removed profile values return a configuration error. Restart Rel.AI and reconnect the MCP client after changing between `compact` and `core` so the host refreshes discovery.

Exact action fields, annotations, execution classes, native Task support, and concurrency scope are available through `relai://server/tool-surface`.
