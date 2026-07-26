// @ts-check
'use strict';

/** @typedef {import('../../types/boundaries').ToolDefinition} ToolDefinition */

const { MAX_BATCH_EDITS } = require('../editLimits');

const TOOL_SURFACE_VERSION = 12;

// The per-tool `annotations` below are placeholders: every one is replaced by
// annotationsFor(name) when TOOL_DEFINITIONS is built, which derives the hints from
// the READ_ONLY_TOOLS / DESTRUCTIVE_TOOLS / OPEN_WORLD_TOOLS sets. Edit those sets,
// not the literals.
/** @type {ToolDefinition[]} */
const TOOL_DEFINITION_VALUES = [
  {
    name: "relai_start_task",
    title: "Start Logical Task",
    description: "Create an independent logical Rel.AI task and return an opaque task_id. Call this once for each unrelated ChatGPT task, then pass the returned task_id to every subsequent task-scoped tool call. The identity does not depend on ChatGPT conversation metadata or transport sessions.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"openWorldHint":false},
    handler: "startTask",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workflow","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_repo_snapshot",
    title: "Repository Overview",
    description: "Read-only. Compact repository overview: file tree, manifests, detected checks, and project hints.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"maxEntries":{"type":"number","minimum":1,"maximum":20000},"includeFiles":{"type":"boolean"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "repoSnapshot",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"snapshot","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_read",
    title: "Read Local Repo Paths",
    description: "Read-only. Batch-read files or directory summaries. Ordinary hidden and Git-ignored files can be read when explicitly targeted; snapshot exclusions are not direct-access restrictions. Secret-bearing paths remain blocked. Use startLine/endLine for one bounded line range across the whole batch, or ranges:[{path,startLine,endLine}] to give individual paths their own window in a single call. guidanceMode accepts full, compact, or none.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"paths":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":100},"maxBytes":{"type":"number","minimum":1000,"maximum":10485760},"maxEntries":{"type":"number","minimum":1,"maximum":20000},"startLine":{"type":"number","minimum":1,"maximum":10000000},"endLine":{"type":"number","minimum":1,"maximum":10000000},"ranges":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"startLine":{"type":"number","minimum":1,"maximum":10000000},"endLine":{"type":"number","minimum":1,"maximum":10000000}},"required":["path"],"additionalProperties":false},"minItems":1,"maxItems":100},"guidanceMode":{"type":"string","enum":["full","compact","none"]}},"required":["workspace","paths"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "read",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"read","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_search",
    title: "Search Workspace Text",
    description: "Read-only. Search tracked and untracked workspace files. Auto mode is the default: focused searches receive broader context, while noisy searches receive smaller prioritized ranges. Compact and context modes remain explicit deterministic overrides.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"pattern":{"type":"string","minLength":1,"maxLength":1000},"glob":{"type":"string","maxLength":256},"fixed":{"type":"boolean"},"ignoreCase":{"type":"boolean"},"maxResults":{"type":"number","minimum":1,"maximum":1000},"mode":{"type":"string","enum":["auto","compact","context"]},"contextBefore":{"type":"number","minimum":0,"maximum":100},"contextAfter":{"type":"number","minimum":0,"maximum":100},"groupByFile":{"type":"boolean"},"mergeOverlaps":{"type":"boolean"},"maxFiles":{"type":"number","minimum":1,"maximum":200},"maxRangesPerFile":{"type":"number","minimum":1,"maximum":100},"maxRangeLines":{"type":"number","minimum":1,"maximum":1000},"maxBytes":{"type":"number","minimum":1000,"maximum":393216}},"required":["workspace","pattern"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "search",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_code_inspect",
    title: "Code Intelligence",
    description: "Read-only. Build a fingerprint-invalidated live code index and inspect recognized symbols, references and calls, structurally related files, reverse-import impact, affected tests, and available language-diagnostic commands. This is bounded lexical and import-graph analysis, not an embedding service or compiler language server.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"action":{"type":"string","enum":["symbol","references","related","impact","diagnostics"]},"symbol":{"type":"string","minLength":1,"maxLength":256},"query":{"type":"string","minLength":1,"maxLength":1000},"paths":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":100},"maxResults":{"type":"number","minimum":1,"maximum":1000},"maxDepth":{"type":"number","minimum":1,"maximum":8},"maxFiles":{"type":"number","minimum":1,"maximum":20000}},"required":["workspace","action"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "codeInspect",
    connectorStrip: [],
    groups: ["audit"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_exec",
    title: "Run Workspace Command",
    description: "Run a one-shot development command inside a configured workspace and return exit status, bounded stdout and stderr, timing, and detected file changes. cwd is workspace-relative. A successful result does not replace final relai_run_checks validation.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"command":{"type":"string","minLength":1,"maxLength":20000},"cwd":{"type":"string"},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000},"env":{"type":"object","additionalProperties":{"type":"string"}},"maxOutputBytes":{"type":"number","minimum":1000,"maximum":16777216}},"required":["workspace","command"],"additionalProperties":false},
    annotations: {"readOnlyHint":false,"destructiveHint":true,"idempotentHint":false,"openWorldHint":true},
    handler: "exec",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"exec","cache":"workspace","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_tidy_plan",
    title: "Workspace Tidy Plan",
    description: "Read-only. Prepare a bounded workspace tidy plan for session-owned untracked artifacts. The server selects candidates; callers do not provide file paths.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"mode":{"type":"string"},"maxCandidates":{"type":"number","minimum":1,"maximum":100}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "tidyPlan",
    connectorStrip: [],
    groups: ["cleanup"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_tidy_run",
    title: "Run Workspace Tidy Plan",
    description: "Apply a previously prepared workspace tidy plan by planId. The plan is expiry-bound and hash-checked before any workspace change.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"planId":{"type":"string"}},"required":["workspace","planId"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "tidyRun",
    connectorStrip: [],
    groups: ["cleanup"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_run_checks",
    title: "Workspace Checks",
    description: "Run workspace validation checks (tests, linters, analyzers, build). Use level quick, standard, or release. Output is bounded to each step's tail where failures appear; pass fullOutput:true for a larger tail. On the final validation, pass complete:true with summary to explicitly validate and close the task atomically. Otherwise use relai_complete_task after any final read-only review.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"level":{"type":"string","enum":["quick","standard","release"]},"check":{"type":"string"},"checks":{"type":"array","items":{"type":"string"},"minItems":0},"checksText":{"type":"string"},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000},"stopOnFailure":{"type":"boolean"},"fullOutput":{"type":"boolean"},"complete":{"type":"boolean"},"summary":{"type":"string","minLength":1,"maxLength":2000}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "runChecks",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"checks","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":"checks"},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_http_probe",
    title: "HTTP Route Probe",
    description: "Read-only. Check one configured local Rel.AI route such as /health or /dashboard and return reachability, HTTP status, final URL, response byte count, title, and bounded diagnostics. The route must be a local path.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"route":{"type":"string","minLength":1},"timeoutMs":{"type":"number","minimum":1000,"maximum":600000}},"required":["workspace","route"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "httpProbe",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_ui_check",
    title: "Named UI Check",
    description: "Run one declared package.json script intended for interface validation. The check name must exactly match an existing script.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"check":{"type":"string","minLength":1},"timeoutMs":{"type":"number","minimum":1000,"maximum":1800000}},"required":["workspace","check"],"additionalProperties":false},
    annotations: {"readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"openWorldHint":false},
    handler: "uiCheck",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"checks","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":"checks"},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_diff",
    title: "Review Local Repo Diff",
    description: "Read-only. Return repository status and current diff as a review artifact. Set redactSensitive:true to omit raw sensitive-file hunks and return metadata-only summaries; .env summaries identify added, removed, and changed key names without values. Pass path to filter to one file.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"staged":{"type":"boolean"},"path":{"type":"string"},"redactSensitive":{"type":"boolean"},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "diff",
    connectorStrip: [],
    groups: ["audit"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":"diff"},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_restore_paths",
    title: "Restore Tracked Paths",
    description: "Restore only the listed tracked paths from HEAD. This does not remove untracked files and does not affect unrelated paths.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"paths":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":100}},"required":["workspace","paths"],"additionalProperties":false},
    annotations: {"readOnlyHint":false,"destructiveHint":true,"idempotentHint":false,"openWorldHint":false},
    handler: "restorePaths",
    connectorStrip: [],
    groups: ["cleanup"],
    behavior: {"audit":"","cache":"paths","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_reset_workspace",
    title: "Reset Workspace State",
    description: "Discard all tracked working-tree and index changes by resetting to HEAD. Pass confirmation RESET. Set removeUntracked:true and confirmation RESET_AND_CLEAN to also remove untracked files and directories.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"confirmation":{"type":"string","enum":["RESET","RESET_AND_CLEAN"]},"removeUntracked":{"type":"boolean"}},"required":["workspace","confirmation"],"additionalProperties":false},
    annotations: {"readOnlyHint":false,"destructiveHint":true,"idempotentHint":false,"openWorldHint":false},
    handler: "resetWorkspace",
    connectorStrip: [],
    groups: ["cleanup"],
    behavior: {"audit":"","cache":"workspace","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":true}
  },
  {
    name: "relai_status",
    title: "Workspace and Repository Status",
    description: "Read-only. Return configured workspace aliases and tool-surface status. When workspace is provided, also return command configuration, session policy, branch, ahead/behind counts, ownership-split changes, and untracked-file state under workspace.repository.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880}},"required":[],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "status",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_commit",
    title: "Record Commit",
    description: "Record a commit with an explicit message and optional path scoping. Sensitive paths require sensitiveAuthorization:{ operation:'commit', paths:[...], reason:'...' }; every staged sensitive path must be listed. The legacy allowSecretPaths flag is accepted only with explicit paths during migration.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"message":{"type":"string"},"dryRun":{"type":"boolean"},"addAll":{"type":"boolean"},"allowSecretPaths":{"type":"boolean"},"sensitiveAuthorization":{"type":"object","properties":{"operation":{"type":"string","enum":["commit"]},"paths":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":200},"reason":{"type":"string","minLength":1,"maxLength":500}},"required":["operation","paths","reason"],"additionalProperties":false},"paths":{"type":"array","items":{"type":"string"},"minItems":0,"maxItems":200},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000}},"required":["workspace","message"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitCommit",
    connectorStrip: [],
    groups: ["git"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_push",
    title: "Publish Branch",
    description: "Publish a branch to a remote, with optional dry-run and set-upstream behavior.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"remote":{"type":"string"},"branch":{"type":"string"},"dryRun":{"type":"boolean"},"setUpstream":{"type":"boolean"},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitPush",
    connectorStrip: [],
    groups: ["git"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_draft_pr",
    title: "Draft Pull Request Text",
    description: "Read-only. Prepare a local pull-request title and body from a base/head Git diff. This does not call a hosting provider, create a remote pull request, push a branch, or modify the repository.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"base":{"type":"string"},"head":{"type":"string"},"title":{"type":"string"},"body":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitDraftPr",
    connectorStrip: [],
    groups: ["git","audit"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_edit",
    title: "Unified Workspace Edit",
    description: `The one tool for changing files. Use oldText/newText with optional occurrence, replacements:[...] for several exact edits in one file, content for full-file replacement, updateText for patch-shaped changes, or edits:[...] for an atomic batch of up to ${MAX_BATCH_EDITS} files. Use updateText or staged updateText for larger repository-wide changes. Large content stages automatically; explicit stage start/append/commit accepts either content chunks or updateText chunks. expectedSha256 is supported for direct, staged, and batch file edits.`,
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000},"replacements":{"type":"array","items":{"type":"object","properties":{"oldText":{"type":"string"},"newText":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000}},"required":["oldText","newText"],"additionalProperties":false},"minItems":1,"maxItems":50},"content":{"type":"string"},"expectedSha256":{"type":"string"},"updateText":{"type":"string"},"envAction":{"type":"string","enum":["list","set","remove","compare"]},"key":{"type":"string","minLength":1,"maxLength":256},"value":{"type":"string","maxLength":65536},"templatePath":{"type":"string"},"edits":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000},"replacements":{"type":"array","items":{"type":"object","properties":{"oldText":{"type":"string"},"newText":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000}},"required":["oldText","newText"],"additionalProperties":false},"minItems":1,"maxItems":50},"content":{"type":"string"},"expectedSha256":{"type":"string"}},"required":["path"],"additionalProperties":false},"minItems":1,"maxItems":MAX_BATCH_EDITS},"runChecks":{"type":"boolean"},"level":{"type":"string","enum":["quick","standard","release"]},"returnDiff":{"type":"boolean"},"dryRun":{"type":"boolean"},"stage":{"type":"string","enum":["start","append","commit","abort"]},"writeId":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "edit",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"edit","cache":"edit","startsSession":true,"deferStagedSession":true,"sessionWrite":true,"summary":"edit"},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_complete_task",
    title: "Report Task Completion",
    description: "Explicitly close the task identified by task_id after its final read-only review. Use this when the final relai_run_checks call did not pass complete:true with summary. Validation and mutation checks are restricted to that exact logical task; Rel.AI never falls back to another task in the workspace.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"summary":{"type":"string","minLength":1,"maxLength":2000}},"required":["workspace","summary"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "completeTask",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"completion","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":"completion"},
    dashboard: {"category":"Workflow","requiredProfile":"workspace","requiresApproval":false}
  },
];
const READ_ONLY_TOOLS = new Set([
  'relai_repo_snapshot', 'relai_read', 'relai_search', 'relai_code_inspect', 'relai_http_probe', 'relai_diff', 'relai_status',
  'relai_git_draft_pr'
]);
const DESTRUCTIVE_TOOLS = new Set([
  'relai_exec', 'relai_tidy_run', 'relai_restore_paths', 'relai_reset_workspace', 'relai_edit'
]);
const OPEN_WORLD_TOOLS = new Set(['relai_exec', 'relai_git_push']);

function annotationsFor(name) {
  const readOnly = READ_ONLY_TOOLS.has(name);
  return {
    readOnlyHint: readOnly,
    destructiveHint: DESTRUCTIVE_TOOLS.has(name),
    idempotentHint: readOnly,
    openWorldHint: OPEN_WORLD_TOOLS.has(name)
  };
}

/** @type {readonly ToolDefinition[]} */
const TOOL_DEFINITIONS = Object.freeze(TOOL_DEFINITION_VALUES.map((definition) => Object.freeze({
  ...definition,
  annotations: annotationsFor(definition.name)
})));
const TOOL_DEFINITION_BY_NAME = new Map(TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

/** @param {string} name @returns {ToolDefinition | null} */
function getToolDefinition(name) {
  return TOOL_DEFINITION_BY_NAME.get(String(name || '')) || null;
}

/** @returns {readonly ToolDefinition[]} */
function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}

/** @returns {{ schemaVersion: number, toolSurfaceVersion: number, toolCount: number, tools: Array<Record<string, unknown>>, deprecations: Array<Record<string, unknown>>, compatibilityAliases: Record<string, string> }} */
function getToolSurfaceManifest() {
  const tools = TOOL_DEFINITIONS.map((definition) => {
    const lifecycle = definition.lifecycle || { state: 'active' };
    return {
      name: definition.name,
      state: lifecycle.state,
      ...(lifecycle.replacement ? { replacement: lifecycle.replacement } : {}),
      ...(Array.isArray(lifecycle.replacements) && lifecycle.replacements.length ? { replacements: [...lifecycle.replacements] } : {}),
      ...(lifecycle.deprecatedSince ? { deprecatedSince: lifecycle.deprecatedSince } : {}),
      ...(lifecycle.removalTarget ? { removalTarget: lifecycle.removalTarget } : {}),
      ...(lifecycle.note ? { note: lifecycle.note } : {})
    };
  });
  return {
    schemaVersion: 1,
    toolSurfaceVersion: TOOL_SURFACE_VERSION,
    toolCount: tools.length,
    tools,
    deprecations: tools.filter((tool) => tool.state === 'deprecated'),
    compatibilityAliases: {}
  };
}

/** @returns {Record<string, string[]>} */
function getToolGroups() {
  /** @type {Record<string, string[]>} */
  const groups = {
    workspace: TOOL_DEFINITIONS.map((definition) => definition.name),
    git: [],
    audit: [],
    cleanup: []
  };
  for (const definition of TOOL_DEFINITIONS) {
    for (const group of definition.groups || []) {
      if (!groups[group]) groups[group] = [];
      groups[group].push(definition.name);
    }
  }
  return groups;
}

module.exports = {
  TOOL_SURFACE_VERSION,
  TOOL_DEFINITIONS,
  getToolDefinition,
  getToolDefinitions,
  getToolGroups,
  getToolSurfaceManifest
};
