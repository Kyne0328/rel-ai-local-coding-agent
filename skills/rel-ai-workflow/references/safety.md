# Rel.AI Safety

## General rules

Work only inside an authorized configured workspace. Keep one `work_id` for operations whose correctness depends on logical-task ownership, but do not create or resurrect a task merely to perform an authorized read, observation, artifact transfer, or resource recovery action whose public contract is task-optional. Inspect relevant files before editing. Treat pre-existing changes as user-owned unless the task explicitly includes them. Use bounded reads, outputs, patches, and process logs.

## Approval-gated operations

Never bypass or simulate approval. Preserve the signed request state and retry only with the accepted response. Native approval remains required for workspace reset and real Git push. Local commits use their explicit path/addAll/sensitive-authorization contract and must not gain a second approval prompt without a demonstrated risk that the existing boundary does not cover.

## Destructive changes

Prefer focused edits or `relai_changes` action `restore` for listed tracked paths. Use reset only when the requested scope is the entire workspace. `removeUntracked:true` broadens reset to remove untracked files and directories; the native reset approval must bind that choice. Do not add or ask for model-supplied magic confirmation strings as duplicate consent. Review existing uncommitted changes first.

## Command execution

Use `relai_exec` for bounded one-shot development commands and `relai_process` for persistent or interactive commands. Do not use either as an unrestricted command router. Respect configured workspace, environment, timeout, output, cancellation, and process-tree limits. A successful command is not final validation unless it ran through the validation operation.

## Commit, push, and pull requests

Review changes before publishing. Commit only the intended paths. Sensitive files require explicit scoped authorization naming every sensitive path and a reason. Push only to an allowed remote and branch after approval. Pull-request drafting is local text generation and does not create or publish a remote pull request.

## Uncertainty

When scope, ownership, or approval is unclear, inspect status and return the uncertainty. Do not broaden paths, infer consent, weaken validation, or replace a refused operation with a more destructive one.
