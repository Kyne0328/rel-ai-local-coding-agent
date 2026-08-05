# Workflow reliability

Rel.AI MCP exposes 12 consolidated public tools. The sequence is flexible: use only the stages the work requires.

```text
1. Identify: relai_work action=begin once per independent repository objective
2. Inspect:  relai_snapshot when an overview is useful
3. Locate:   relai_search when raw text or source context is needed
4. Trace:    relai_inspect for symbols, callers, impact, and affected tests
5. Read:     relai_read for relevant files or line ranges
6. Develop:  relai_exec for one-shot project commands when needed
7. Change:   relai_edit
8. Validate + finish atomically: relai_validate action=checks with complete:true and summary
9. Alternative post-validation review: relai_validate action=checks -> relai_work action=status / relai_changes action=diff -> relai_work action=finish
10. Recover: relai_changes actions restore, reset, tidy_plan, and tidy_run
11. Publish: relai_publish action=commit -> relai_publish action=push
12. Prepare review text when useful: relai_publish action=draft_pr
```

The compact work bootstrap and any refreshed snapshot are bounded repository maps, not access boundaries. Search and direct reads can continue anywhere inside the work-session-bound workspace. When `projectInstructions` is present, apply its sources in the returned precedence order: `REL_AI.md` overrides `.relai/instructions.md`, and the nearest applicable `AGENTS.override.md` or `AGENTS.md` overrides parent-directory guidance. Read a named file directly if the combined 64 KiB payload is truncated. The server does not execute instruction content, generate helper scripts, expose hidden tool tiers, or route around the registered workspace tools.

## Tool selection

| Situation | Use |
| --- | --- |
| Start an independent repository objective | `relai_work` with `action:"begin"`; reuse its `work_id` on subsequent calls |
| Repository overview | `relai_snapshot` |
| Repository-specific architecture and workflow rules | `projectInstructions` from the bootstrap or snapshot; direct `relai_read` when truncated |
| Locate code with surrounding source | `relai_search`; adaptive auto mode is the default |
| Symbol definitions, references, calls, reverse-import impact, and affected tests | `relai_inspect` |
| Focused file content | `relai_read` |
| Small localized edit | `relai_edit` with `oldText` and `newText` |
| Complete file replacement | `relai_edit` with `content` |
| Multi-file patch or tracked-file deletion | `relai_edit` with `updateText` |
| Several edits in one request | `relai_edit` with `edits` |
| Session-owned untracked cleanup | `relai_changes` with `action:"tidy_plan"` then `relai_changes` with `action:"tidy_run"` |
| Dependency installation, migrations, compilers, and repository utilities | `relai_exec` |
| Change-aware validation | `relai_validate` with `action:"checks"`; planning is internal when no exact check is supplied |
| Exact package script or UI/browser validation | `relai_validate` with `action:"checks"` with `check:"npm run <script>"` |
| Final validation and atomic finish | `relai_validate` with `action:"checks"` with `complete:true` and `summary` |
| Finish after post-validation read-only review | `relai_work` with `action:"finish"` |
| Local HTTP route validation | `relai_validate` with `action:"http"` |
| Workspace, branch, ownership, and untracked state | `relai_work` with `action:"status"` with `workspace` |
| File-level review | `relai_changes` with `action:"diff"` |
| Restore listed tracked paths only | `relai_changes` with `action:"restore"` |
| Reset all tracked workspace changes | `relai_changes` with `action:"reset"` with `confirmation:"RESET"` |
| Reset tracked changes and remove all untracked files | `relai_changes` with `action:"reset"` with `removeUntracked:true` and `confirmation:"RESET_AND_CLEAN"` |
| Prepare local pull-request text | `relai_publish` with `action:"draft_pr"` |

`relai_search` defaults to adaptive auto mode. It prioritizes files using query-to-path relevance and bounded match density. Explicit compact mode preserves path/line output; explicit context mode applies caller-controlled limits. Context results merge overlaps by default, include SHA-256 file hashes, and report separate match and context truncation.

`relai_read` accepts either `paths` or per-file `ranges`. The latter supports a multi-file targeted read in one call without requiring a duplicate `paths` list.

## Work-session identity

A `work_id` identifies one repository objective across multiple MCP calls. It is:

- bound to one configured workspace;
- bound to the authenticated principal that created it;
- independent of HTTP or stdio transport identity;
- distinct from a native MCP `taskId` and managed-process `processId`;
- rejected after terminal completion, failure, or cancellation except for idempotent control calls.

Native MCP Tasks own one asynchronous request. They do not replace the work session. Managed processes own persistent operating-system processes and do not complete their work session automatically.

## Validation behavior

`relai_validate` with `action:"checks"` exposes `level` presets:

| Level | Meaning |
| --- | --- |
| `quick` | Syntax and lightweight checks |
| `standard` | Normal project validation; the default |
| `release` | Broad release validation |

When no explicit check is supplied, Rel.AI creates a short-lived, content-bound validation plan internally from current changes, import impact, affected tests, and repository checks. The caller does not need a separate planning tool.

Completion is never inferred from validation alone. Passing `complete:true` with a non-empty `summary` explicitly closes the work session in the same final validation call. When read-only review must happen afterward, run checks without completion and then call `relai_work` with `action:"finish"`. `relai_exec` is a development command runner; a command such as `npm test` does not establish final validation by itself.

## MCP execution modes

Rel.AI uses MCP `2026-07-28` for modern HTTP and stdio requests. The HTTP endpoint also accepts ChatGPT's SDK-supported stateless `2025-11-25` initialize flow. The Tasks extension is negotiated independently on every modern request; initialize-based clients use bounded synchronous execution for eligible operations.

- A clearly bounded eligible call may return directly even when the client supports Tasks.
- A long or indeterminate eligible call returns a native MCP task when the client advertises `io.modelcontextprotocol/tasks`.
- A client without Tasks support receives bounded synchronous execution.
- Persistent interactive commands use `relai_process_*`, not native task identity.

## Edit safeguards

`relai_edit` uses one discriminated mutation mode per request: exact replacement, replacement batch, complete-file content, patch text, multi-file edit batch, environment operation, or staged write. Unsupported combinations fail schema validation before execution.

Exact replacements require current text. An optional 64-character `expectedSha256` from `relai_read` makes stale edits fail closed. Duplicate matches require `occurrence` or a larger unique block.

Patch-shaped calls can enforce a clean worktree, create a tracked-change backup, and reject updates above the configured maximum size.

## Deletion safeguards

Tracked files are deleted through structured patch operations:

```text
*** Begin Patch
*** Delete File: path/to/file
*** End Patch
```

Untracked files are not accepted as arbitrary deletion arguments. `relai_changes` with `action:"tidy_plan"` selects current-session candidates, and `relai_changes` with `action:"tidy_run"` verifies the plan ID, expiry, workspace, ownership, file shape, and content hash before deletion.
