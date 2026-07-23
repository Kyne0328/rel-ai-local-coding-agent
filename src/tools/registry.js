// @ts-check
'use strict';

/** @typedef {import('../../types/boundaries').ToolDefinition} ToolDefinition */
/** @type {ToolDefinition[]} */
const TOOL_DEFINITION_VALUES = [
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
    description: "Read-only. Batch-read files or directory summaries. Use startLine/endLine for a bounded line range. guidanceMode accepts full, compact, or none.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"paths":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":100},"maxBytes":{"type":"number","minimum":1000,"maximum":10485760},"maxEntries":{"type":"number","minimum":1,"maximum":20000},"startLine":{"type":"number","minimum":1,"maximum":10000000},"endLine":{"type":"number","minimum":1,"maximum":10000000},"guidanceMode":{"type":"string","enum":["full","compact","none"]}},"required":["workspace","paths"],"additionalProperties":false},
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
    name: "relai_write",
    title: "Write Local Repo File",
    description: "Full-file replacement. Prefer direct { workspace, path, content } for complete-file updates — direct write has no size cap. Staged mode (stage:'start'/'append'/'commit') exists only for transports that cap a single message; if used and writeId is omitted, append/commit resolve the single in-flight staged write (or pass path to disambiguate when several are pending).",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"path":{"type":"string"},"content":{"type":"string"},"dryRun":{"type":"boolean"},"stage":{"type":"string"},"writeId":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "write",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"path","cache":"paths","startsSession":true,"deferStagedSession":true,"sessionWrite":true,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_replace",
    title: "Replace Exact Text",
    description: "Small deterministic edits inside an existing file. Provide { workspace, path, oldText, newText } or replacements: [{ oldText, newText, occurrence? }]. Duplicate matches require occurrence.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"},"expectedSha256":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000},"replacements":{"type":"array","items":{"type":"object","properties":{"oldText":{"type":"string"},"newText":{"type":"string"},"occurrence":{"type":"number","minimum":1,"maximum":1000000}},"required":["oldText","newText"],"additionalProperties":false},"minItems":1,"maxItems":50},"dryRun":{"type":"boolean"}},"required":["workspace","path"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "replace",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"path","cache":"paths","startsSession":true,"deferStagedSession":false,"sessionWrite":true,"summary":""},
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
    description: "Run workspace validation checks (tests, linters, analyzers, build). Use level quick, standard, or release. Output is bounded to each step's tail where failures appear; pass fullOutput:true for a larger tail. Use level quick while iterating; run standard or release once before relai_complete_task.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"level":{"type":"string"},"check":{"type":"string"},"checks":{"type":"array","items":{"type":"string"},"minItems":0},"checksText":{"type":"string"},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000},"stopOnFailure":{"type":"boolean"},"fullOutput":{"type":"boolean"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "runChecks",
    connectorStrip: ["check","checks","checksText"],
    groups: [],
    behavior: {"audit":"checks","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":"checks"},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_browser",
    title: "UI Route Check",
    description: "Load a configured workspace route (route) and return its HTTP status, byte count, title, and errors. Pass check to run a named package.json script; only declared scripts are accepted.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"url":{"type":"string"},"route":{"type":"string"},"check":{"type":"string"},"timeoutMs":{"type":"number","minimum":1000,"maximum":1800000}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "browser",
    connectorStrip: ["url"],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_diff",
    title: "Review Local Repo Diff",
    description: "Read-only. Return repository status and current diff as a review artifact. Pass path to filter to a single file. When a trusted session is active, sessionChangedFiles and baselineChangedFiles split the status entries by ownership (this session vs. pre-existing dirty worktree).",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"staged":{"type":"boolean"},"path":{"type":"string"},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "diff",
    connectorStrip: [],
    groups: ["audit"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":"diff"},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_restore_changes",
    title: "Revert To Saved State",
    description: "Revert selected workspace changes, or return the workspace to the last saved state.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"paths":{"type":"array","items":{"type":"string"},"minItems":0,"maxItems":100},"mode":{"type":"string"},"clean":{"type":"boolean"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "restore",
    connectorStrip: [],
    groups: ["cleanup"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_status",
    title: "Rel.AI Status",
    description: "Read-only. Compact live status for configured workspaces, scripts, and CI references. Prefer this over reading source files when checking whether an update is active. Includes active session policy and trusted-agent state.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"}},"required":[],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "status",
    connectorStrip: [],
    groups: [],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_status",
    title: "Repository State",
    description: "Read-only repository state: current branch, ahead/behind counts, ownership split, and untracked-file summary. Reports metadata only and changes nothing.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitStatus",
    connectorStrip: [],
    groups: ["git","audit"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_git_commit",
    title: "Record Commit",
    description: "Record a commit with an explicit message, with optional dry-run planning and path scoping.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"message":{"type":"string"},"dryRun":{"type":"boolean"},"addAll":{"type":"boolean"},"allowSecretPaths":{"type":"boolean"},"paths":{"type":"array","items":{"type":"string"},"minItems":0,"maxItems":200},"maxBytes":{"type":"number","minimum":1000,"maximum":5242880},"timeoutMs":{"type":"number","minimum":1000,"maximum":86400000}},"required":["workspace","message"],"additionalProperties":false},
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
    name: "relai_git_create_pr",
    title: "Draft Pull Request",
    description: "Read-only. Draft a pull-request title/body from a base/head diff without touching the remote host.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"base":{"type":"string"},"head":{"type":"string"},"title":{"type":"string"},"body":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
    annotations: {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: "gitCreatePr",
    connectorStrip: [],
    groups: ["git"],
    behavior: {"audit":"","cache":"","startsSession":false,"deferStagedSession":false,"sessionWrite":false,"summary":""},
    dashboard: {"category":"Workspace tools","requiredProfile":"workspace","requiresApproval":false}
  },
  {
    name: "relai_edit",
    title: "Unified Workspace Edit",
    description: "The one tool for changing files. The server auto-picks the mechanism: oldText+newText for an exact edit, content for a full-file write (large files chunk automatically), updateText for a unified/OpenAI diff, or edits:[...] to apply several edits in one call. Pass runChecks:true to validate (optional level quick/standard/release, default standard) and returnDiff:true to review, all in one approval.",
    inputSchema: {"type":"object","properties":{"workspace":{"type":"string"},"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"},"content":{"type":"string"},"updateText":{"type":"string"},"edits":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"},"content":{"type":"string"}},"required":["path"],"additionalProperties":false},"minItems":1,"maxItems":20},"runChecks":{"type":"boolean"},"level":{"type":"string"},"returnDiff":{"type":"boolean"},"dryRun":{"type":"boolean"},"stage":{"type":"string"},"writeId":{"type":"string"}},"required":["workspace"],"additionalProperties":false},
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
    description: "Call exactly once as the final Rel.AI tool after the final relai_run_checks call succeeds and no further code changes are planned. Rel.AI rejects completion if this work session has no passed validation or if code changed after it. This explicitly tells the dashboard that ChatGPT finished the coding task.",
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
  'relai_repo_snapshot', 'relai_read', 'relai_search', 'relai_diff', 'relai_status',
  'relai_git_status', 'relai_git_create_pr'
]);
const DESTRUCTIVE_TOOLS = new Set([
  'relai_exec', 'relai_write', 'relai_replace', 'relai_tidy_run', 'relai_restore_changes', 'relai_edit'
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
  TOOL_DEFINITIONS,
  getToolDefinition,
  getToolDefinitions,
  getToolGroups
};
