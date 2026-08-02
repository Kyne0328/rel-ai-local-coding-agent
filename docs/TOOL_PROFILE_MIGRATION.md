# Rel.AI Tool Profiles and Migration

Rel.AI exposes the compact profile by default. It contains 12 capability-oriented tools and is the preferred architecture. The legacy profile retains the previous 30-tool surface only for migration and compatibility testing.

## Selecting a profile

Set one value in the Rel.AI configuration file:

```json
{
  "toolProfile": "compact"
}
```

`compact` is the default and may be omitted. To opt into the transitional surface, set:

```json
{
  "toolProfile": "legacy"
}
```

The value must be exactly `compact` or `legacy`. A combined value such as `compact,legacy` is rejected during configuration loading; the two registries are never merged. Restart the MCP server and reconnect the client after changing profiles so discovery is refreshed.

## Complete migration table

| Legacy tool | Compact tool | Action | Behavioral difference |
| --- | --- | --- | --- |
| `relai_begin_work` | `relai_work` | `begin` | Add `action`; result omits duplicated workspace binding and next-step prose. |
| `relai_repo_snapshot` | `relai_snapshot` | — | Name only. |
| `relai_read` | `relai_read` | — | None. |
| `relai_search` | `relai_search` | `text` | Add `action`. |
| `relai_code_inspect` | `relai_inspect` | Existing inspection action | Tool renamed; inspection action is retained. |
| `relai_exec` | `relai_exec` | — | None. |
| `relai_process_start` | `relai_process` | `start` | Add `action`. |
| `relai_process_read` | `relai_process` | `read` | Add `action`. |
| `relai_process_write` | `relai_process` | `write` | Add `action`. |
| `relai_process_stop` | `relai_process` | `stop` | Add `action`. |
| `relai_process_list` | `relai_process` | `list` | Add `action`. |
| `relai_worktree_create` | `relai_worktree` | `create` | Add `action`. |
| `relai_worktree_list` | `relai_worktree` | `list` | Add `action`. |
| `relai_worktree_remove` | `relai_worktree` | `remove` | Add `action`; approval is unchanged. |
| `relai_semantic_search` | `relai_search` | `semantic` | Add `action`. |
| `relai_diagnostics_run` | `relai_validate` | `diagnostics` | Add `action`. |
| `relai_tidy_plan` | `relai_changes` | `tidy_plan` | Add `action`. |
| `relai_tidy_run` | `relai_changes` | `tidy_run` | Add `action`. |
| `relai_run_checks` | `relai_validate` | `checks` | Add `action`; atomic completion behavior is unchanged. |
| `relai_http_probe` | `relai_validate` | `http` | Add `action`. |
| `relai_diff` | `relai_changes` | `diff` | Add `action`. |
| `relai_restore_paths` | `relai_changes` | `restore` | Add `action`. |
| `relai_reset_workspace` | `relai_changes` | `reset` | Add `action`; confirmation and approval are unchanged. |
| `relai_status` | `relai_work` | `status` | Add `action`; compact status omits duplicated registry details. |
| `relai_git_commit` | `relai_publish` | `commit` | Add `action`; sensitive-path authorization is unchanged. |
| `relai_git_push` | `relai_publish` | `push` | Add `action`; approval and allowlists are unchanged. |
| `relai_git_draft_pr` | `relai_publish` | `draft_pr` | Add `action`; this still generates local draft text only. |
| `relai_edit` | `relai_edit` | — | None. |
| `relai_cancel_work` | `relai_work` | `cancel` | Add `action`. |
| `relai_finish_work` | `relai_work` | `finish` | Add `action`. |

Every compact action dispatches to the same internal operation used by the corresponding legacy tool. Action-specific required fields, bounds, work-session ownership, cancellation, approvals, destructive-operation safeguards, process lifecycle rules, and audit behavior remain server-enforced.

## Deprecation policy

The legacy profile is transitional and opt-in. New examples, tests, and integrations should use the compact profile. Removal requires a future versioned migration decision and must not occur without an announced compatibility window.
