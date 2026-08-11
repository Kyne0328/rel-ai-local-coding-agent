// @ts-check

import { MAX_BATCH_EDITS } from '../editLimits.js';
import { outputSchemaFor } from './outputSchemas.js';

/** @typedef {import('../../types/boundaries.d.ts').ToolDefinitionMetadata} ToolDefinitionMetadata */
/** @typedef {Omit<ToolDefinitionMetadata, 'annotations' | 'connectorStrip' | 'groups' | 'behavior' | 'dashboard' | 'outputSchema'> & { annotations?: Partial<ToolDefinitionMetadata['annotations']>, connectorStrip?: string[], groups?: import('../../types/boundaries.d.ts').ToolGroup[], behavior?: Partial<ToolDefinitionMetadata['behavior']>, dashboard?: Partial<ToolDefinitionMetadata['dashboard']>, outputSchema?: import('../../types/boundaries.d.ts').JsonSchema }} ToolDefinitionInput */



/** @type {ToolDefinitionInput[]} */
const OPERATION_DEFINITION_VALUES = [
  {
    name: "relai_begin_work",
    title: "Start Logical Task",
    description: "Create an independent workspace-bound Rel.AI task and return its opaque work_id plus compact repository bootstrap context. Call this once for each unrelated ChatGPT task. Subsequent task-scoped tools require work_id and resolve the bound workspace automatically; workspace may be supplied only as an ownership assertion.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"title":{"type":"string","minLength":1,"maxLength":100},"objective":{"type":"string","minLength":1,"maxLength":500},"bootstrap":{"type":"string","enum":["compact","full","none"],"description":"Initial repository context returned with the task. Defaults to compact."},"instructionPath":{"type":"string","maxLength":1000,"description":"Optional workspace-relative file or directory used to discover applicable nested AGENTS.md instructions."}},"required":["workspace"],"additionalProperties":false},
    handlerName: 'startTask',
    behavior: {"taskScope":"none"},
    dashboard: {"category":"Workflow"}
  },
  {
    name: "relai_repo_snapshot",
    title: "Repository Overview",
    description: "Read-only. Compact repository overview: file tree, manifests, detected checks, and project hints.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"maxEntries":{"type":"number","minimum":1,"maximum":20000},"includeFiles":{"type":"boolean"}},"required":["workspace"],"additionalProperties":false},
    handlerName: 'repoSnapshot',
    behavior: {"audit":"snapshot"},
  },
  {
    name: "relai_read",
    title: "Read Local Repo Paths",
    description: "Read-only. Batch-read files or directory summaries. Ordinary hidden and Git-ignored files can be read when explicitly targeted; snapshot exclusions are not direct-access restrictions. Secret-bearing paths remain blocked. Use startLine/endLine for one bounded line range across the whole batch, or ranges:[{path,startLine,endLine}] to give individual paths their own window in a single call. guidanceMode accepts full, compact, or none.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"paths":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":100},"maxBytes":{"type":"number","minimum":1000,"maximum":10485760},"maxEntries":{"type":"number","minimum":1,"maximum":20000},"startLine":{"type":"number","minimum":1,"maximum":10000000},"endLine":{"type":"number","minimum":1,"maximum":10000000},"ranges":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string","minLength":1,"maxLength":1000},"startLine":{"type":"number","minimum":1,"maximum":10000000},"endLine":{"type":"number","minimum":1,"maximum":10000000}},"required":["path"],"additionalProperties":false},"minItems":1,"maxItems":100},"guidanceMode":{"type":"string","enum":["full","compact","none"]}},"required":["workspace"],"anyOf":[{"required":["paths"]},{"required":["ranges"]}],"additionalProperties":false},
    handlerName: 'read',
    behavior: {"audit":"read"},
  },
  {
    name: "relai_search",
    title: "Search Workspace Text",
    description: "Read-only. Search tracked and untracked workspace files. Auto mode is the default: focused searches receive broader context, while noisy searches receive smaller prioritized ranges. Compact and context modes remain explicit deterministic overrides.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"pattern":{"type":"string","minLength":1,"maxLength":1000},"glob":{"type":"string","maxLength":256},"fixed":{"type":"boolean"},"ignoreCase":{"type":"boolean"},"maxResults":{"type":"number","minimum":1,"maximum":1000},"mode":{"type":"string","enum":["auto","compact","context"]},"contextBefore":{"type":"number","minimum":0,"maximum":100},"contextAfter":{"type":"number","minimum":0,"maximum":100},"groupByFile":{"type":"boolean"},"mergeOverlaps":{"type":"boolean"},"maxFiles":{"type":"number","minimum":1,"maximum":200},"maxRangesPerFile":{"type":"number","minimum":1,"maximum":100},"maxRangeLines":{"type":"number","minimum":1,"maximum":1000},"maxBytes":{"type":"number","minimum":1000,"maximum":393216}},"required":["workspace","pattern"],"additionalProperties":false},
    handlerName: 'search',
  },
  {
    name: "relai_code_inspect",
    title: "Code Intelligence",
    description: "Read-only. Build a persistent local code index and inspect symbols, references, structural impact, affected tests, architecture boundaries, entry points, hotspots, dependency layers, graph communities, and available language diagnostics. This remains bounded local graph analysis, not an embedding service or resident compiler language server.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"action":{"type":"string","enum":["symbol","references","related","impact","trace","diagnostics","architecture"]},"symbol":{"type":"string","minLength":1,"maxLength":256},"query":{"type":"string","minLength":1,"maxLength":1000},"paths":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":100},"maxResults":{"type":"number","minimum":1,"maximum":1000},"maxDepth":{"type":"number","minimum":1,"maximum":8},"maxFiles":{"type":"number","minimum":1,"maximum":20000}},"required":["workspace","action"],"additionalProperties":false},
    handlerName: 'codeInspect',
    groups: ["audit"],
  },
  {
    name: "relai_exec",
    title: "Run Workspace Command",
    description: "Run a one-shot development command inside a configured workspace and return exit status, bounded stdout and stderr, timing, and detected file changes. cwd is workspace-relative. A successful result does not replace final relai_validate action 'checks' validation.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"command":{"type":"string","minLength":1,"maxLength":20000},"cwd":{"type":"string"},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000},"env":{"type":"object","additionalProperties":{"type":"string"}},"maxOutputBytes":{"type":"number","minimum":1000,"maximum":16777216}},"required":["workspace","command"],"additionalProperties":false},
    handlerName: 'exec',
    behavior: {"audit":"exec","cache":"workspace","longRunning":true},
  },
  {
    name: "relai_process_start",
    title: "Start Managed Process",
    description: "Start a persistent service, watcher, or interactive program with stable identity, bounded persistent logs, interactive stdin, and workspace/task attribution. One-shot tests, builds, checks, and release gates must use relai_exec or relai_validate with action 'checks' instead.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"command":{"type":"string","minLength":1,"maxLength":20000},"cwd":{"type":"string"},"env":{"type":"object","additionalProperties":{"type":"string"}},"label":{"type":"string","maxLength":120},"kind":{"type":"string","enum":["service","watcher","interactive"]},"purpose":{"type":"string","minLength":1,"maxLength":300},"reuseExisting":{"type":"boolean"},"startupWaitMs":{"type":"number","minimum":0,"maximum":30000},"maxLogBytes":{"type":"number","minimum":65536,"maximum":268435456}},"required":["workspace","command","kind","purpose"],"additionalProperties":false},
    handlerName: 'processStart',
    behavior: {"audit":"exec","cache":"workspace"},
  },
  {
    name: "relai_process_read",
    title: "Read Managed Process",
    description: "Read process state and new stdout/stderr ranges using independent byte cursors.",
    inputSchema: {"type":"object","properties":{"processId":{"type":"string","minLength":1,"maxLength":200},"stdoutOffset":{"type":"number","minimum":0},"stderrOffset":{"type":"number","minimum":0},"maxBytes":{"type":"number","minimum":1000,"maximum":1048576},"includeMetadata":{"type":"boolean"},"metadataRevision":{"type":"string","minLength":1,"maxLength":100}},"required":["processId"],"additionalProperties":false},
    handlerName: 'processRead',
  },
  {
    name: "relai_process_write",
    title: "Write Managed Process Input",
    description: "Write bounded UTF-8 input to a running managed process stdin.",
    inputSchema: {"type":"object","properties":{"processId":{"type":"string","minLength":1,"maxLength":200},"input":{"type":"string","maxLength":1048576}},"required":["processId","input"],"additionalProperties":false},
    handlerName: 'processWrite',
    behavior: {"audit":"exec"},
  },
  {
    name: "relai_process_stop",
    title: "Stop Managed Process",
    description: "Stop a managed process and its process tree, then return final state and recent output.",
    inputSchema: {"type":"object","properties":{"processId":{"type":"string","minLength":1,"maxLength":200},"graceMs":{"type":"number","minimum":0,"maximum":30000}},"required":["processId"],"additionalProperties":false},
    handlerName: 'processStop',
    behavior: {"audit":"exec"},
  },
  {
    name: "relai_process_list",
    title: "List Managed Processes",
    description: "List active managed processes by default. Set includeTerminal:true to include recent exited, failed, or stopped records.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"status":{"type":"string","enum":["starting","running","stopping","exited","failed","stopped","orphaned"]},"activeOnly":{"type":"boolean"},"includeTerminal":{"type":"boolean"},"limit":{"type":"number","minimum":1,"maximum":500}},"required":[],"additionalProperties":false},
    handlerName: 'processList',
  },
  {
    name: "relai_worktree_create",
    title: "Create Managed Worktree",
    description: "Create a Git worktree and branch under Rel.AI-managed storage and register its dynamic workspace alias.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"name":{"type":"string","minLength":1,"maxLength":80},"base":{"type":"string","maxLength":200},"branch":{"type":"string","maxLength":200}},"required":["workspace","name"],"additionalProperties":false},
    handlerName: 'worktreeCreate',
    groups: ["git"],
    behavior: {"audit":"exec","cache":"workspace","concurrencyScope":"workspace"},
  },
  {
    name: "relai_worktree_list",
    title: "List Managed Worktrees",
    description: "List managed worktrees with branch, availability, and dirty-state information.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"}},"required":[],"additionalProperties":false},
    handlerName: 'worktreeList',
    groups: ["git","audit"],
  },
  {
    name: "relai_worktree_remove",
    title: "Remove Managed Worktree",
    description: "Remove one managed worktree. Dirty worktrees and active managed processes are refused unless separately resolved; the branch is preserved.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"alias":{"type":"string","minLength":1,"maxLength":180},"force":{"type":"boolean"}},"required":["workspace","alias"],"additionalProperties":false},
    handlerName: 'worktreeRemove',
    groups: ["git","cleanup"],
    behavior: {"audit":"exec","cache":"workspace","concurrencyScope":"workspace"},
    dashboard: {"requiresApproval":true}
  },
  {
    name: "relai_semantic_search",
    title: "Hybrid Semantic Search",
    description: "Read-only. Rank local source files with persistent Tree-sitter structure, code-graph, Zoekt when available, FTS5 lexical, path, and symbol signals. No neural model is used and no source text leaves the machine.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"query":{"type":"string","minLength":1,"maxLength":2000},"maxResults":{"type":"number","minimum":1,"maximum":100},"maxFiles":{"type":"number","minimum":1,"maximum":20000},"pathPrefix":{"type":"string","maxLength":500},"language":{"type":"string","maxLength":80}},"required":["workspace","query"],"additionalProperties":false},
    handlerName: 'semanticSearch',
  },
  {
    name: "relai_diagnostics_run",
    title: "Run Structured Diagnostics",
    description: "Run detected or explicit language diagnostics and normalize file, line, column, severity, code, message, and source.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"command":{"type":"string","minLength":1,"maxLength":20000},"commands":{"type":"array","items":{"type":"string","minLength":1,"maxLength":20000},"minItems":1,"maxItems":50},"level":{"type":"string","enum":["quick","standard","release"]},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000},"maxResults":{"type":"number","minimum":1,"maximum":5000},"stopOnFailure":{"type":"boolean"}},"required":["workspace"],"oneOf":[{"required":["command"],"not":{"anyOf":[{"required":["commands"]},{"required":["level"]}]}},{"required":["commands"],"not":{"anyOf":[{"required":["command"]},{"required":["level"]}]}},{"required":["level"],"not":{"anyOf":[{"required":["command"]},{"required":["commands"]}]}},{"not":{"anyOf":[{"required":["command"]},{"required":["commands"]},{"required":["level"]}]}}],"additionalProperties":false},
    handlerName: 'diagnosticsRun',
    behavior: {"audit":"checks","summary":"checks","longRunning":true},
  },
  {
    name: "relai_tidy_plan",
    title: "Workspace Tidy Plan",
    description: "Read-only. Prepare a bounded workspace tidy plan for session-owned untracked artifacts. The server selects candidates; callers do not provide file paths.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"mode":{"type":"string","enum":["session_untracked"]},"maxCandidates":{"type":"number","minimum":1,"maximum":100}},"required":["workspace"],"additionalProperties":false},
    handlerName: 'tidyPlan',
    groups: ["cleanup"],
  },
  {
    name: "relai_tidy_run",
    title: "Run Workspace Tidy Plan",
    description: "Apply a previously prepared workspace tidy plan by planId. The plan is expiry-bound and hash-checked before any workspace change.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"planId":{"type":"string","minLength":20,"maxLength":120,"pattern":"^tidy_[A-Za-z0-9_-]+$"}},"required":["workspace","planId"],"additionalProperties":false},
    handlerName: 'tidyRun',
    groups: ["cleanup"],
    behavior: {"concurrencyScope":"workspace"},
  },
  {
    name: "relai_run_checks",
    title: "Workspace Checks",
    description: "Run workspace validation checks (tests, linters, analyzers, build). Use level quick, standard, or release. Output is bounded to each step's tail where failures appear; pass fullOutput:true for a larger tail. On the final validation, pass complete:true with summary to explicitly validate and close the task atomically. Otherwise use relai_work with action 'finish' after any final read-only review.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"level":{"type":"string","enum":["quick","standard","release"]},"check":{"type":"string","minLength":1,"maxLength":20000},"checks":{"type":"array","items":{"type":"string","minLength":1,"maxLength":20000},"minItems":1,"maxItems":50},"checksText":{"type":"string","minLength":1,"maxLength":100000},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000},"stopOnFailure":{"type":"boolean"},"fullOutput":{"type":"boolean"},"complete":{"type":"boolean"},"summary":{"type":"string","minLength":1,"maxLength":2000}},"required":["workspace"],"oneOf":[{"required":["check"],"not":{"anyOf":[{"required":["checks"]},{"required":["checksText"]},{"required":["level"]}]}},{"required":["checks"],"not":{"anyOf":[{"required":["check"]},{"required":["checksText"]},{"required":["level"]}]}},{"required":["checksText"],"not":{"anyOf":[{"required":["check"]},{"required":["checks"]},{"required":["level"]}]}},{"required":["level"],"not":{"anyOf":[{"required":["check"]},{"required":["checks"]},{"required":["checksText"]}]}},{"not":{"anyOf":[{"required":["check"]},{"required":["checks"]},{"required":["checksText"]},{"required":["level"]}]}}],"additionalProperties":false},
    handlerName: 'runChecks',
    behavior: {"audit":"checks","summary":"checks","longRunning":true},
  },
  {
    name: "relai_http_probe",
    title: "HTTP Route Probe",
    description: "Read-only. Check one configured local Rel.AI route such as /health or /dashboard and return reachability, HTTP status, final URL, response byte count, title, and bounded diagnostics. The route must be a local path.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"route":{"type":"string","minLength":1},"timeoutMs":{"type":"number","minimum":1000,"maximum":600000}},"required":["workspace","route"],"additionalProperties":false},
    handlerName: 'httpProbe',
  },
  {
    name: "relai_diff",
    title: "Review Local Repo Diff",
    description: "Read-only. Return repository status and current diff as a review artifact. Set redactSensitive:true to omit raw sensitive-file hunks and return metadata-only summaries; .env summaries identify added, removed, and changed key names without values. Pass path to filter to one file.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"staged":{"type":"boolean"},"path":{"type":"string"},"redactSensitive":{"type":"boolean"},"scope":{"type":"string","enum":["task","workspace"]},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880}},"required":["workspace"],"additionalProperties":false},
    handlerName: 'diff',
    groups: ["audit"],
    behavior: {"summary":"diff"},
  },
  {
    name: "relai_restore_paths",
    title: "Restore Tracked Paths",
    description: "Restore only the listed tracked paths from HEAD. This does not remove untracked files and does not affect unrelated paths.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"paths":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":100}},"required":["workspace","paths"],"additionalProperties":false},
    handlerName: 'restorePaths',
    groups: ["cleanup"],
    behavior: {"cache":"paths","concurrencyScope":"workspace"},
  },
  {
    name: "relai_reset_workspace",
    title: "Reset Workspace State",
    description: "Discard all tracked working-tree and index changes by resetting to HEAD. Pass confirmation RESET. Set removeUntracked:true and confirmation RESET_AND_CLEAN to also remove untracked files and directories.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"confirmation":{"type":"string","enum":["RESET","RESET_AND_CLEAN"]},"removeUntracked":{"type":"boolean"}},"required":["workspace","confirmation"],"additionalProperties":false},
    handlerName: 'resetWorkspace',
    groups: ["cleanup"],
    behavior: {"cache":"workspace","concurrencyScope":"workspace"},
    dashboard: {"requiresApproval":true}
  },
  {
    name: "relai_status",
    title: "Workspace and Repository Status",
    description: "Read-only. Return configured workspace aliases and tool-surface status. When workspace is provided, also return command configuration, session policy, branch, ahead/behind counts, ownership-split changes, and untracked-file state under workspace.repository.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880}},"required":[],"additionalProperties":false},
    handlerName: 'status',
    behavior: {"taskScope":"optional"},
  },
  {
    name: "relai_git_commit",
    title: "Record Commit",
    description: "Record a commit with an explicit message and optional path scoping. Sensitive paths require sensitiveAuthorization:{ operation:'commit', paths:[...], reason:'...' }; every staged sensitive path must be listed.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"message":{"type":"string","minLength":1,"maxLength":4000},"dryRun":{"type":"boolean"},"addAll":{"type":"boolean"},"sensitiveAuthorization":{"type":"object","properties":{"operation":{"type":"string","enum":["commit"]},"paths":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":200},"reason":{"type":"string","minLength":1,"maxLength":500}},"required":["operation","paths","reason"],"additionalProperties":false},"paths":{"type":"array","items":{"type":"string","minLength":1,"maxLength":1000},"minItems":1,"maxItems":200},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000}},"required":["workspace","message"],"additionalProperties":false},
    handlerName: 'gitCommit',
    groups: ["git"],
    behavior: {"concurrencyScope":"workspace"},
  },
  {
    name: "relai_git_push",
    title: "Publish Branch",
    description: "Publish a branch to a remote, with optional dry-run and set-upstream behavior.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"remote":{"type":"string","minLength":1,"maxLength":200},"branch":{"type":"string","minLength":1,"maxLength":500},"dryRun":{"type":"boolean"},"setUpstream":{"type":"boolean"},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000}},"required":["workspace"],"additionalProperties":false},
    handlerName: 'gitPush',
    groups: ["git"],
    behavior: {"concurrencyScope":"workspace"},
  },
  {
    name: "relai_git_draft_pr",
    title: "Draft Pull Request Text",
    description: "Read-only. Prepare a local pull-request title and body from a base/head Git diff. This does not call a hosting provider, create a remote pull request, push a branch, or modify the repository.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"base":{"type":"string"},"head":{"type":"string"},"title":{"type":"string"},"body":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
    handlerName: 'gitDraftPr',
    groups: ["git","audit"],
  },
  {
    name: "relai_edit",
    title: "Unified Workspace Edit",
    description: `The one tool for changing files. Use oldText/newText with optional occurrence, replacements:[...] for several exact edits in one file, content for full-file replacement, updateText for patch-shaped changes, or edits:[...] for an atomic batch of up to ${MAX_BATCH_EDITS} files. Keep larger repository-wide changes together as one logical updateText patch; if one request is too large, send staged updateText chunks and commit once instead of splitting the migration into repeated edit batches. Large content stages automatically. expectedSha256 is supported for direct, staged, and batch file edits.`,
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"path":{"type":"string","minLength":1,"maxLength":1000},"oldText":{"type":"string"},"newText":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000},"replacements":{"type":"array","items":{"type":"object","properties":{"oldText":{"type":"string"},"newText":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000}},"required":["oldText","newText"],"additionalProperties":false},"minItems":1,"maxItems":50},"content":{"type":"string"},"expectedSha256":{"type":"string","pattern":"^[a-fA-F0-9]{64}$"},"updateText":{"type":"string"},"envAction":{"type":"string","enum":["list","set","remove","compare"]},"key":{"type":"string","minLength":1,"maxLength":256},"value":{"type":"string","maxLength":65536},"templatePath":{"type":"string"},"edits":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000},"replacements":{"type":"array","items":{"type":"object","properties":{"oldText":{"type":"string"},"newText":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000}},"required":["oldText","newText"],"additionalProperties":false},"minItems":1,"maxItems":50},"content":{"type":"string"},"expectedSha256":{"type":"string","pattern":"^[a-fA-F0-9]{64}$"}},"required":["path"],"additionalProperties":false},"minItems":1,"maxItems":MAX_BATCH_EDITS},"runChecks":{"type":"boolean"},"level":{"type":"string","enum":["quick","standard","release"]},"returnDiff":{"type":"boolean"},"dryRun":{"type":"boolean"},"stage":{"type":"string","enum":["start","append","commit","abort"]},"writeId":{"type":"string","minLength":1,"maxLength":200}},"required":["workspace"],"oneOf":[{"required":["path","oldText","newText"],"not":{"anyOf":[{"required":["replacements"]},{"required":["content"]},{"required":["updateText"]},{"required":["edits"]},{"required":["envAction"]},{"required":["stage"]}]}},{"required":["path","replacements"],"not":{"anyOf":[{"required":["oldText"]},{"required":["content"]},{"required":["updateText"]},{"required":["edits"]},{"required":["envAction"]},{"required":["stage"]}]}},{"required":["path","content"],"not":{"anyOf":[{"required":["oldText"]},{"required":["replacements"]},{"required":["updateText"]},{"required":["edits"]},{"required":["envAction"]},{"required":["stage"]}]}},{"required":["updateText"],"not":{"anyOf":[{"required":["oldText"]},{"required":["replacements"]},{"required":["content"]},{"required":["edits"]},{"required":["envAction"]},{"required":["stage"]}]}},{"required":["edits"],"not":{"anyOf":[{"required":["oldText"]},{"required":["replacements"]},{"required":["content"]},{"required":["updateText"]},{"required":["envAction"]},{"required":["stage"]}]}},{"required":["envAction"],"not":{"anyOf":[{"required":["oldText"]},{"required":["replacements"]},{"required":["content"]},{"required":["updateText"]},{"required":["edits"]},{"required":["stage"]}]}},{"required":["stage"],"not":{"anyOf":[{"required":["oldText"]},{"required":["replacements"]},{"required":["edits"]},{"required":["envAction"]}]}}],"additionalProperties":false},
    handlerName: 'edit',
    behavior: {"audit":"edit","cache":"edit","startsSession":true,"deferStagedSession":true,"sessionWrite":true,"summary":"edit"},
  },
  {
    name: "relai_cancel_work",
    title: "Cancel Logical Task",
    description: "Cancel the exact logical task identified by work_id. Cancellation is idempotent, preserves partial progress and final timestamps, records a bounded reason, and cooperatively aborts active subprocess-backed operations when supported.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"reason":{"type":"string","maxLength":500}},"required":[],"additionalProperties":false},
    handlerName: 'cancelTask',
    behavior: {"audit":"exec"},
    dashboard: {"category":"Workflow"}
  },
  {
    name: "relai_finish_work",
    title: "Report Task Completion",
    description: "Explicitly close the task identified by work_id after its final read-only review. Use this when the final relai_validate action 'checks' call did not pass complete:true with summary. Validation and mutation checks are restricted to that exact logical task; Rel.AI never falls back to another task in the workspace.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"summary":{"type":"string","minLength":1,"maxLength":2000}},"required":["workspace","summary"],"additionalProperties":false},
    handlerName: 'completeTask',
    behavior: {"audit":"completion","summary":"completion"},
    dashboard: {"category":"Workflow"}
  },
];
const READ_ONLY_TOOLS = new Set([
  'relai_repo_snapshot', 'relai_read', 'relai_search', 'relai_code_inspect', 'relai_semantic_search',
  'relai_process_read', 'relai_process_list', 'relai_worktree_list',
  'relai_tidy_plan', 'relai_http_probe', 'relai_diff', 'relai_status', 'relai_git_draft_pr'
]);
const DESTRUCTIVE_TOOLS = new Set([
  'relai_exec', 'relai_process_start', 'relai_process_write', 'relai_process_stop',
  'relai_worktree_remove', 'relai_diagnostics_run', 'relai_tidy_run', 'relai_run_checks',
  'relai_restore_paths', 'relai_reset_workspace', 'relai_edit'
]);
const IDEMPOTENT_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  'relai_process_stop', 'relai_restore_paths', 'relai_reset_workspace',
  'relai_cancel_work', 'relai_finish_work'
]);
const OPEN_WORLD_TOOLS = new Set([
  'relai_exec', 'relai_process_start', 'relai_process_write',
  'relai_diagnostics_run', 'relai_run_checks', 'relai_git_push'
]);
const NATIVE_TASK_ELIGIBLE_TOOLS = new Set([
  'relai_exec', 'relai_diagnostics_run', 'relai_run_checks'
]);
const PERSISTENT_PROCESS_TOOLS = new Set([
  'relai_process_start', 'relai_process_read', 'relai_process_write', 'relai_process_stop', 'relai_process_list'
]);
const ALWAYS_IMMEDIATE_TOOLS = new Set([
  'relai_begin_work', 'relai_repo_snapshot', 'relai_read', 'relai_search',
  'relai_status', 'relai_cancel_work', 'relai_finish_work'
]);

function annotationsFor(name) {
  return {
    readOnlyHint: READ_ONLY_TOOLS.has(name),
    destructiveHint: DESTRUCTIVE_TOOLS.has(name),
    idempotentHint: IDEMPOTENT_TOOLS.has(name),
    openWorldHint: OPEN_WORLD_TOOLS.has(name)
  };
}

function executionClassFor(name) {
  if (NATIVE_TASK_ELIGIBLE_TOOLS.has(name)) return 'native_task_eligible';
  if (PERSISTENT_PROCESS_TOOLS.has(name)) return 'persistent_process';
  if (ALWAYS_IMMEDIATE_TOOLS.has(name)) return 'always_immediate';
  return 'bounded_synchronous';
}

const DEFAULT_BEHAVIOR = Object.freeze({
  audit: '', cache: '', startsSession: false, deferStagedSession: false, sessionWrite: false, summary: '', longRunning: false,
  taskScope: 'required', concurrencyScope: 'task', executionClass: 'bounded_synchronous'
});
const DEFAULT_DASHBOARD = Object.freeze({
  category: 'Workspace tools', requiredProfile: 'workspace', requiresApproval: false
});

/** @param {ToolDefinitionInput} definition @returns {ToolDefinitionMetadata} */
function defineTool(definition) {
  return Object.freeze({
    ...definition,
    connectorStrip: [...(definition.connectorStrip || [])],
    groups: [...(definition.groups || [])],
    annotations: Object.freeze(annotationsFor(definition.name)),
    ...(NATIVE_TASK_ELIGIBLE_TOOLS.has(definition.name)
      ? { execution: Object.freeze({ taskSupport: 'optional' }) }
      : {}),
    outputSchema: Object.freeze(definition.outputSchema || outputSchemaFor(definition.name)),
    behavior: Object.freeze({
      ...DEFAULT_BEHAVIOR,
      ...(definition.behavior || {}),
      executionClass: executionClassFor(definition.name)
    }),
    dashboard: Object.freeze({ ...DEFAULT_DASHBOARD, ...(definition.dashboard || {}) })
  });
}

/** @type {readonly ToolDefinitionMetadata[]} */
const OPERATION_DEFINITIONS = Object.freeze(OPERATION_DEFINITION_VALUES.map(defineTool));
const OPERATION_DEFINITION_BY_NAME = new Map(OPERATION_DEFINITIONS.map((definition) => [definition.name, definition]));

/** @param {string} name @returns {ToolDefinitionMetadata | null} */
function getOperationDefinition(name) {
  return OPERATION_DEFINITION_BY_NAME.get(String(name || '')) || null;
}

/** @returns {readonly ToolDefinitionMetadata[]} */
function getOperationDefinitions() {
  return OPERATION_DEFINITIONS;
}


const STRING = Object.freeze({ type: 'string' });
const WORKSPACE = Object.freeze({ type: 'string' });
const ACTION = values => ({ type: 'string', enum: values });
const RESULT_SCHEMA = Object.freeze({
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: true
});


const PUBLIC_DEFINITION_VALUES = [
  define({
    name: 'relai_work',
    title: 'Manage Repository Work',
    description: 'Manage work sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        action: ACTION(['begin', 'status', 'finish', 'cancel']),
        workspace: WORKSPACE,
        title: { type: 'string', minLength: 1, maxLength: 100 },
        objective: { type: 'string', minLength: 1, maxLength: 500 },
        bootstrap: { type: 'string', enum: ['compact', 'full', 'none'] },
        instructionPath: { type: 'string', maxLength: 1000 },
        maxBytes: { type: 'number', minimum: 1000, maximum: 5242880 },
        summary: { type: 'string', minLength: 1, maxLength: 2000 },
        reason: { type: 'string', maxLength: 500 }
      },
      required: ['action'],
      oneOf: [
        branch('begin', ['workspace'], ['work_id', 'summary', 'reason', 'maxBytes']),
        branch('status', [], ['title', 'objective', 'bootstrap', 'instructionPath', 'summary', 'reason']),
        branch('finish', ['work_id', 'summary'], ['title', 'objective', 'bootstrap', 'instructionPath', 'maxBytes', 'reason']),
        branch('cancel', ['work_id'], ['title', 'objective', 'bootstrap', 'instructionPath', 'maxBytes', 'summary'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, false, false, false),
    behavior: { taskScope: 'optional', executionClass: 'always_immediate' },
    dashboard: { category: 'Workflow', capabilities: ['workflow'] }
  }),
  cloneOperation('relai_repo_snapshot', 'relai_snapshot', 'Repository Snapshot', 'Map repository context.'),
  cloneOperation('relai_read', 'relai_read', 'Read Repository', 'Read files, ranges, or directories.'),
  define({
    name: 'relai_search',
    title: 'Search Repository',
    description: 'Search text or rank code semantically.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['text', 'semantic']),
        pattern: { type: 'string', minLength: 1, maxLength: 1000 },
        glob: { type: 'string', maxLength: 256 },
        fixed: { type: 'boolean' },
        ignoreCase: { type: 'boolean' },
        mode: { type: 'string', enum: ['auto', 'compact', 'context'] },
        contextBefore: { type: 'number', minimum: 0, maximum: 100 },
        contextAfter: { type: 'number', minimum: 0, maximum: 100 },
        groupByFile: { type: 'boolean' },
        mergeOverlaps: { type: 'boolean' },
        maxFiles: { type: 'number', minimum: 1, maximum: 20000 },
        maxRangesPerFile: { type: 'number', minimum: 1, maximum: 100 },
        maxRangeLines: { type: 'number', minimum: 1, maximum: 1000 },
        maxBytes: { type: 'number', minimum: 1000, maximum: 393216 },
        maxResults: { type: 'number', minimum: 1, maximum: 1000 },
        query: { type: 'string', minLength: 1, maxLength: 2000 },
        pathPrefix: { type: 'string', maxLength: 500 },
        language: { type: 'string', maxLength: 80 }
      },
      required: ['action'],
      oneOf: [
        branch('text', ['pattern'], ['query', 'pathPrefix', 'language'], { maxFiles: { type: 'number', minimum: 1, maximum: 200 } }),
        branch('semantic', ['query'], ['pattern', 'glob', 'fixed', 'ignoreCase', 'mode', 'contextBefore', 'contextAfter', 'groupByFile', 'mergeOverlaps', 'maxRangesPerFile', 'maxRangeLines', 'maxBytes'], { maxResults: { type: 'number', minimum: 1, maximum: 100 } })
      ],
      additionalProperties: false
    },
    annotations: annotations(true, false, true, false)
  }),
  define({
    name: 'relai_inspect',
    title: 'Inspect Code Relationships',
    description: 'Inspect code relationships and impact.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['symbol', 'references', 'related', 'impact', 'trace', 'diagnostics', 'architecture']),
        symbol: { type: 'string', minLength: 1, maxLength: 256 },
        query: { type: 'string', minLength: 1, maxLength: 1000 },
        paths: { type: 'array', items: STRING, minItems: 1, maxItems: 100 },
        maxResults: { type: 'number', minimum: 1, maximum: 1000 },
        maxDepth: { type: 'number', minimum: 1, maximum: 8 },
        maxFiles: { type: 'number', minimum: 1, maximum: 20000 }
      },
      required: ['action'],
      oneOf: [
        branch('symbol', ['symbol'], ['query', 'paths', 'maxDepth']),
        branch('references', ['symbol'], ['query', 'paths', 'maxDepth']),
        branch('related', [], ['paths', 'maxDepth'], {}, {
          anyOf: [{ required: ['query'] }, { required: ['symbol'] }]
        }),
        branch('impact', [], ['query'], {}, {
          anyOf: [{ required: ['symbol'] }, { required: ['paths'] }]
        }),
        branch('trace', ['symbol'], ['query', 'paths']),
        branch('diagnostics', [], ['symbol', 'query', 'paths', 'maxResults', 'maxDepth']),
        branch('architecture', [], ['symbol', 'query', 'paths', 'maxDepth'])
      ],
      additionalProperties: false
    },
    annotations: annotations(true, false, true, false),
    groups: ['audit']
  }),
  clonePublicEditOperation(),
  cloneOperation('relai_exec', 'relai_exec', 'Run Command', 'Run a bounded command.', { dashboard: { capabilities: ['execute'] } }),
  define({
    name: 'relai_process',
    title: 'Manage Process',
    description: 'Manage development processes.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['start', 'read', 'write', 'stop', 'list']),
        command: { type: 'string', minLength: 1, maxLength: 20000 },
        cwd: STRING,
        env: { type: 'object', additionalProperties: STRING },
        label: { type: 'string', maxLength: 120 },
        kind: { type: 'string', enum: ['service', 'watcher', 'interactive'] },
        purpose: { type: 'string', minLength: 1, maxLength: 300 },
        reuseExisting: { type: 'boolean' },
        startupWaitMs: { type: 'number', minimum: 0, maximum: 30000 },
        maxLogBytes: { type: 'number', minimum: 65536, maximum: 268435456 },
        processId: { type: 'string', minLength: 1, maxLength: 200 },
        stdoutOffset: { type: 'number', minimum: 0 },
        stderrOffset: { type: 'number', minimum: 0 },
        maxBytes: { type: 'number', minimum: 1000, maximum: 1048576 },
        includeMetadata: { type: 'boolean' },
        metadataRevision: { type: 'string', minLength: 1, maxLength: 100 },
        input: { type: 'string', maxLength: 1048576 },
        graceMs: { type: 'number', minimum: 0, maximum: 30000 },
        status: { type: 'string', enum: ['starting', 'running', 'stopping', 'exited', 'failed', 'stopped', 'orphaned'] },
        activeOnly: { type: 'boolean' },
        includeTerminal: { type: 'boolean' },
        limit: { type: 'number', minimum: 1, maximum: 500 }
      },
      required: ['action'],
      oneOf: [
        branch('start', ['command', 'kind', 'purpose'], ['reuseExisting', 'processId', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'input', 'graceMs', 'status', 'activeOnly', 'includeTerminal', 'limit']),
        branch('read', ['processId'], ['command', 'cwd', 'env', 'label', 'kind', 'purpose', 'reuseExisting', 'startupWaitMs', 'maxLogBytes', 'input', 'graceMs', 'status', 'activeOnly', 'includeTerminal', 'limit']),
        branch('write', ['processId', 'input'], ['command', 'cwd', 'env', 'label', 'kind', 'purpose', 'reuseExisting', 'startupWaitMs', 'maxLogBytes', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'graceMs', 'status', 'activeOnly', 'includeTerminal', 'limit']),
        branch('stop', ['processId'], ['command', 'cwd', 'env', 'label', 'kind', 'purpose', 'reuseExisting', 'startupWaitMs', 'maxLogBytes', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'input', 'status', 'activeOnly', 'includeTerminal', 'limit']),
        branch('list', [], ['command', 'cwd', 'env', 'label', 'kind', 'purpose', 'reuseExisting', 'startupWaitMs', 'maxLogBytes', 'processId', 'stdoutOffset', 'stderrOffset', 'maxBytes', 'includeMetadata', 'metadataRevision', 'input', 'graceMs'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, true, false, true),
    dashboard: { capabilities: ['execute'] },
    behavior: { executionClass: 'persistent_process' }
  }),
  define({
    name: 'relai_worktree',
    title: 'Manage Worktree',
    description: 'Manage Git worktrees.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['create', 'list', 'remove']),
        name: { type: 'string', minLength: 1, maxLength: 80 },
        base: { type: 'string', maxLength: 200 },
        branch: { type: 'string', maxLength: 200 },
        alias: { type: 'string', minLength: 1, maxLength: 180 },
        force: { type: 'boolean' }
      },
      required: ['action'],
      oneOf: [
        branch('create', ['name'], ['alias', 'force']),
        branch('list', [], ['name', 'base', 'branch', 'alias', 'force']),
        branch('remove', ['alias'], ['name', 'base', 'branch'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, true, false, false),
    dashboard: { capabilities: ['git'] },
    groups: ['git']
  }),
  define({
    name: 'relai_validate',
    title: 'Validate Repository',
    description: 'Run checks, diagnostics, or HTTP probes.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['checks', 'diagnostics', 'http']),
        level: { type: 'string', enum: ['quick', 'standard', 'release'] },
        check: { type: 'string', minLength: 1, maxLength: 20000 },
        checks: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 20000 }, minItems: 1, maxItems: 50 },
        checksText: { type: 'string', minLength: 1, maxLength: 100000 },
        command: { type: 'string', minLength: 1, maxLength: 20000 },
        commands: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 20000 }, minItems: 1, maxItems: 50 },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 86400000 },
        stopOnFailure: { type: 'boolean' },
        fullOutput: { type: 'boolean' },
        complete: { type: 'boolean' },
        summary: { type: 'string', minLength: 1, maxLength: 2000 },
        maxResults: { type: 'number', minimum: 1, maximum: 5000 },
        route: { type: 'string', minLength: 1 }
      },
      required: ['action'],
      oneOf: [
        branch('checks', [], ['command', 'commands', 'maxResults', 'route']),
        branch('diagnostics', [], ['check', 'checks', 'checksText', 'fullOutput', 'complete', 'summary', 'route']),
        branch('http', ['route'], ['level', 'check', 'checks', 'checksText', 'command', 'commands', 'stopOnFailure', 'fullOutput', 'complete', 'summary', 'maxResults'], { timeoutMs: { type: 'number', minimum: 1000, maximum: 600000 } })
      ],
      additionalProperties: false
    },
    annotations: annotations(false, true, false, true),
    execution: { taskSupport: 'optional' },
    behavior: { longRunning: true, executionClass: 'native_task_eligible' },
    dashboard: { capabilities: ['validate'] }
  }),
  define({
    name: 'relai_changes',
    title: 'Review or Restore Changes',
    description: 'Review, restore, reset, or tidy changes.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['diff', 'restore', 'reset', 'tidy_plan', 'tidy_run']),
        staged: { type: 'boolean' },
        path: STRING,
        redactSensitive: { type: 'boolean' },
        maxBytes: { type: 'number', minimum: 1000, maximum: 5242880 },
        paths: { type: 'array', items: STRING, minItems: 1, maxItems: 100 },
        confirmation: { type: 'string', enum: ['RESET', 'RESET_AND_CLEAN'] },
        removeUntracked: { type: 'boolean' },
        mode: { type: 'string', enum: ['session_untracked'] },
        maxCandidates: { type: 'number', minimum: 1, maximum: 100 },
        planId: { type: 'string', minLength: 20, maxLength: 120, pattern: '^tidy_[A-Za-z0-9_-]+$' }
      },
      required: ['action'],
      oneOf: [
        branch('diff', [], ['paths', 'confirmation', 'removeUntracked', 'mode', 'maxCandidates', 'planId']),
        branch('restore', ['paths'], ['staged', 'path', 'redactSensitive', 'scope', 'maxBytes', 'confirmation', 'removeUntracked', 'mode', 'maxCandidates', 'planId']),
        branch('reset', ['confirmation'], ['staged', 'path', 'redactSensitive', 'scope', 'maxBytes', 'paths', 'mode', 'maxCandidates', 'planId']),
        branch('tidy_plan', [], ['staged', 'path', 'redactSensitive', 'scope', 'maxBytes', 'paths', 'confirmation', 'removeUntracked', 'planId']),
        branch('tidy_run', ['planId'], ['staged', 'path', 'redactSensitive', 'scope', 'maxBytes', 'paths', 'confirmation', 'removeUntracked', 'mode', 'maxCandidates'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, true, false, false),
    dashboard: { capabilities: ['review', 'recover'] },
    groups: ['audit', 'cleanup']
  }),
  define({
    name: 'relai_publish',
    title: 'Publish Repository Work',
    description: 'Commit, push, or draft PR text.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        action: ACTION(['commit', 'push', 'draft_pr']),
        message: { type: 'string', minLength: 1, maxLength: 4000 },
        dryRun: { type: 'boolean' },
        addAll: { type: 'boolean' },
        sensitiveAuthorization: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['commit'] },
            paths: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 1000 }, minItems: 1, maxItems: 200 },
            reason: { type: 'string', minLength: 1, maxLength: 500 }
          },
          required: ['operation', 'paths', 'reason'],
          additionalProperties: false
        },
        paths: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 1000 }, minItems: 1, maxItems: 200 },
        maxBytes: { type: 'number', minimum: 1000, maximum: 5242880 },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 86400000 },
        remote: { type: 'string', minLength: 1, maxLength: 200 },
        branch: { type: 'string', minLength: 1, maxLength: 500 },
        setUpstream: { type: 'boolean' },
        base: STRING,
        head: STRING,
        title: STRING,
        body: STRING
      },
      required: ['action'],
      oneOf: [
        branch('commit', ['message'], ['remote', 'branch', 'setUpstream', 'base', 'head', 'title', 'body']),
        branch('push', [], ['message', 'addAll', 'sensitiveAuthorization', 'paths', 'maxBytes', 'base', 'head', 'title', 'body']),
        branch('draft_pr', [], ['message', 'dryRun', 'addAll', 'sensitiveAuthorization', 'paths', 'maxBytes', 'timeoutMs', 'remote', 'branch', 'setUpstream'])
      ],
      additionalProperties: false
    },
    annotations: annotations(false, false, false, true),
    dashboard: { capabilities: ['git'] },
    groups: ['git']
  })
];

const PUBLIC_TOOL_DEFINITIONS = Object.freeze(PUBLIC_DEFINITION_VALUES);
const PUBLIC_TOOL_BY_NAME = new Map(PUBLIC_TOOL_DEFINITIONS.map(definition => [definition.name, definition]));

function branch(action, required = [], irrelevant = [], properties = {}, extra = {}) {
  return {
    properties: { action: { const: action }, ...properties },
    required: ['action', ...required],
    ...(irrelevant.length ? { xIrrelevant: irrelevant } : {}),
    ...extra
  };
}

function constrainActionProperties(inputSchema) {
  if (!Array.isArray(inputSchema?.oneOf)) return { inputSchema, actionContracts: [] };
  const actionBranches = inputSchema.oneOf.every(item => item?.properties?.action?.const);
  if (!actionBranches) return { inputSchema, actionContracts: [] };
  const candidateFields = new Set(Object.keys(inputSchema.properties || {}));
  candidateFields.add('work_id');
  const actionContracts = inputSchema.oneOf.map(item => {
    const irrelevant = item.xIrrelevant || [];
    return Object.freeze({
      action: String(item.properties.action.const),
      required: Object.freeze([...(item.required || []).filter(field => field !== 'action')]),
      fields: Object.freeze([...candidateFields].filter(field => field !== 'action' && !irrelevant.includes(field)).sort())
    });
  });
  return {
    inputSchema: {
      ...inputSchema,
      oneOf: inputSchema.oneOf.map(({ xIrrelevant: _xIrrelevant, ...item }) => item)
    },
    actionContracts
  };
}

function cloneOperation(sourceName, name, title, description, overrides = {}) {
  const source = getOperationDefinition(sourceName);
  if (!source) throw new Error(`Missing internal operation definition: ${sourceName}`);
  return define({
    ...source,
    ...overrides,
    name,
    title,
    description,
    outputSchema: RESULT_SCHEMA,
    handlerName: 'compactDispatch'
  });
}

function clonePublicEditOperation() {
  const source = getOperationDefinition('relai_edit');
  if (!source) throw new Error('Missing internal operation definition: relai_edit');
  return cloneOperation('relai_edit', 'relai_edit', 'Edit Repository', source.description, {
    inputSchema: publicEditInputSchema(source.inputSchema),
    dashboard: { capabilities: ['edit'] }
  });
}

// Connector-side JSON Schema implementations vary in how faithfully they expose
// non-discriminated oneOf/not branches to a model. Keep structural validation at
// the MCP boundary, then let the edit planner enforce mode exclusivity before it
// resolves or writes any path. This produces one actionable runtime error instead
// of a wrapper-level list of failures from every possible edit form.
function publicEditInputSchema(inputSchema) {
  const { oneOf: _oneOf, ...structuralSchema } = inputSchema;
  const properties = inputSchema.properties || {};
  const describe = (name, description) => ({ ...properties[name], description });
  return {
    ...structuralSchema,
    description: 'Choose one primary form. Rel.AI validates the selected form before touching the workspace.',
    properties: {
      ...properties,
      workspace: describe('workspace', 'Optional workspace ownership assertion. The work_id already identifies the bound workspace.'),
      path: describe('path', 'Workspace-relative target path. Required for full-file content and exact replacement forms.'),
      oldText: describe('oldText', 'Exact non-empty current text to replace. Pair with newText.'),
      newText: describe('newText', 'Replacement text paired with oldText. An empty string deletes the matched text.'),
      occurrence: describe('occurrence', 'One-based occurrence to replace when oldText is not unique.'),
      replacements: describe('replacements', 'Several exact oldText/newText replacements in one file.'),
      content: describe('content', 'Complete replacement content for one file. Use with path; an empty string creates an empty file.'),
      expectedSha256: describe('expectedSha256', 'Optional stale-write guard for direct, staged, batch, and environment edits.'),
      updateText: describe('updateText', 'Git unified diff or structured OpenAI patch text for patch-shaped changes.'),
      envAction: describe('envAction', 'Secret-safe environment operation: list, set, remove, or compare.'),
      key: describe('key', 'Environment key used by envAction set or remove.'),
      value: describe('value', 'Environment value used by envAction set. Values are never returned.'),
      templatePath: describe('templatePath', 'Public environment template used by envAction compare.'),
      edits: describe('edits', `Atomic structured batch of up to ${MAX_BATCH_EDITS} file edits.`),
      runChecks: describe('runChecks', 'Run detected validation checks after a successful edit.'),
      level: describe('level', 'Validation level used when runChecks is true.'),
      returnDiff: describe('returnDiff', 'Return a bounded diff after a successful edit.'),
      dryRun: describe('dryRun', 'Validate and preview the edit without changing files.'),
      stage: describe('stage', 'Chunked content or updateText lifecycle: start, append, commit, or abort.'),
      writeId: describe('writeId', 'Opaque staged-write ID returned by stage start.')
    }
  };
}

function annotations(readOnlyHint, destructiveHint, idempotentHint, openWorldHint) {
  return Object.freeze({ readOnlyHint, destructiveHint, idempotentHint, openWorldHint });
}

function define(value) {
  const {
    behavior,
    dashboard,
    connectorStrip = [],
    groups = [],
    annotations: toolAnnotations,
    outputSchema = RESULT_SCHEMA,
    ...definition
  } = value;
  const constrained = constrainActionProperties(definition.inputSchema);
  const dashboardMetadata = {
    category: 'Workspace tools',
    requiredProfile: 'workspace',
    requiresApproval: false,
    capabilities: ['inspect'],
    ...(dashboard || {})
  };
  return Object.freeze({
    handlerName: 'compactDispatch',
    ...definition,
    inputSchema: Object.freeze(constrained.inputSchema),
    actionContracts: Object.freeze(constrained.actionContracts),
    behavior: Object.freeze({
      audit: '', cache: '', startsSession: false, deferStagedSession: false, sessionWrite: false,
      summary: '', longRunning: false, taskScope: 'required', concurrencyScope: 'task', executionClass: 'bounded_synchronous',
      ...(behavior || {})
    }),
    dashboard: Object.freeze({
      ...dashboardMetadata,
      capabilities: Object.freeze([...dashboardMetadata.capabilities])
    }),
    connectorStrip: Object.freeze([...connectorStrip]),
    groups: Object.freeze([...groups]),
    annotations: Object.freeze(toolAnnotations || annotations(false, false, false, false)),
    outputSchema: Object.freeze(outputSchema)
  });
}

function getCatalogToolDefinition(name) {
  return PUBLIC_TOOL_BY_NAME.get(String(name || '')) || null;
}

function getCatalogToolDefinitions() {
  return PUBLIC_TOOL_DEFINITIONS;
}

export {
  getCatalogToolDefinition,
  getCatalogToolDefinitions,
  getOperationDefinition,
  getOperationDefinitions
};
