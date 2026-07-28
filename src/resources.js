const crypto = require('node:crypto');
const fs = require('node:fs');
const { readConfig, publicConfigSummary, allWorkspaceAliases, resolveWorkspace } = require('./config');
const { getToolSurfaceManifest } = require('./tools');
const { workspaceProfile, workspaceTree, workspaceInspect, workspaceList } = require('./tools/status');
const pkg = require('../package.json');

const MIME_JSON = 'application/json';
const MIME_MARKDOWN = 'text/markdown';

function listResources() {
  const config = readConfig();
  const resources = [
    resource('relai://server/help', 'Rel.AI MCP Help', 'How ChatGPT should use this Rel.AI MCP server.', MIME_MARKDOWN),
    resource('relai://server/config', 'Rel.AI MCP Config Summary', 'Safe connector configuration summary without secrets.', MIME_JSON),
    resource('relai://server/tool-surface', 'Rel.AI MCP Tool Surface', 'Machine-readable current tool surface and output contracts.', MIME_JSON),
    resource('relai://server/workspaces', 'Rel.AI MCP Workspaces', 'Configured and managed workspace aliases with safe metadata.', MIME_JSON)
  ];
  for (const alias of allWorkspaceAliases(config)) {
    resources.push(
      resource(`relai://workspace/${encodeURIComponent(alias)}/inspect`, `Workspace ${alias} Inspect`, 'Combined workspace profile and filtered project structure.', MIME_JSON),
      resource(`relai://workspace/${encodeURIComponent(alias)}/profile`, `Workspace ${alias} Profile`, 'Detected stack, manifests, checks, and test surface.', MIME_JSON),
      resource(`relai://workspace/${encodeURIComponent(alias)}/tree`, `Workspace ${alias} Tree`, 'Safe filtered file tree for the workspace.', MIME_JSON)
    );
  }
  return {
    resources,
    ttlMs: 15000,
    cacheScope: 'private',
    revision: resourceRevision(config, 'relai://server/resources')
  };
}

function readResource(uri) {
  const config = readConfig();
  const parsed = parseRelaiUri(uri);
  if (parsed.kind === 'server' && parsed.name === 'help') return contents(uri, MIME_MARKDOWN, helpMarkdown(config), config);
  if (parsed.kind === 'server' && parsed.name === 'config') return contents(uri, MIME_JSON, publicConfigSummary(config), config);
  if (parsed.kind === 'server' && parsed.name === 'tool-surface') return contents(uri, MIME_JSON, getToolSurfaceManifest(), config);
  if (parsed.kind === 'server' && parsed.name === 'workspaces') return contents(uri, MIME_JSON, workspaceList(config), config);
  if (parsed.kind === 'workspace') {
    const args = { workspace: parsed.workspace, maxEntries: 800 };
    if (parsed.name === 'inspect') return contents(uri, MIME_JSON, workspaceInspect(config, args), config);
    if (parsed.name === 'profile') return contents(uri, MIME_JSON, workspaceProfile(config, args), config);
    if (parsed.name === 'tree') return contents(uri, MIME_JSON, workspaceTree(config, args), config);
  }
  throw new Error(`Unknown resource: ${uri}`);
}

function parseRelaiUri(uri) {
  const text = String(uri || '').trim();
  if (!text.startsWith('relai://')) throw new Error(`Unsupported resource URI: ${text}`);
  const parts = text.slice('relai://'.length).split('/').map(part => decodeURIComponent(part));
  if (parts[0] === 'server') return { kind: 'server', name: parts[1] || '' };
  if (parts[0] === 'workspace') return { kind: 'workspace', workspace: parts[1] || '', name: parts[2] || '' };
  throw new Error(`Unsupported resource URI: ${text}`);
}

function resource(uri, name, description, mimeType) {
  return { uri, name, description, mimeType, cacheHint: resourceCacheHint(uri) };
}

function contents(uri, mimeType, value, config) {
  const revision = resourceRevision(config, uri);
  const enriched = typeof value === 'string' ? value : { ...value, cache: { ...resourceCacheHint(uri), revision } };
  const text = typeof enriched === 'string' ? enriched : `${JSON.stringify(enriched, null, 2)}\n`;
  return { contents: [{ uri, mimeType, text }], ...resourceCacheHint(uri) };
}

function resourceCacheHint(uri) {
  const text = String(uri || '');
  if (text === 'relai://server/help' || text === 'relai://server/tool-surface') return { ttlMs: 60000, cacheScope: 'private' };
  if (text === 'relai://server/config' || text === 'relai://server/workspaces') return { ttlMs: 15000, cacheScope: 'private' };
  if (text.startsWith('relai://workspace/')) return { ttlMs: 5000, cacheScope: 'private' };
  return { ttlMs: 0, cacheScope: 'private' };
}

function resourceRevision(config, uri) {
  const hash = crypto.createHash('sha256');
  hash.update(pkg.version).update('\0').update(String(getToolSurfaceManifest().toolSurfaceVersion));
  hash.update('\0').update(String(uri || ''));
  hash.update('\0').update(stableJson(publicConfigSummary(config)));
  const parsed = parseRelaiUri(uri);
  if (parsed.kind === 'workspace' && parsed.workspace) {
    try {
      const workspace = resolveWorkspace(config, parsed.workspace);
      const stat = fs.statSync(workspace.path);
      hash.update('\0').update(workspace.path).update('\0').update(String(stat.mtimeMs));
      for (const relative of ['package.json', 'REL_AI.md', '.relai/instructions.md']) {
        try {
          const fileStat = fs.statSync(require('node:path').join(workspace.path, relative));
          hash.update(relative).update(String(fileStat.mtimeMs)).update(String(fileStat.size));
        } catch {}
      }
    } catch {}
  }
  return hash.digest('base64url').slice(0, 24);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function helpMarkdown(config) {
  const workspaces = workspaceList(config).workspaces.map(item => `- ${item.alias}: ${item.path}`).join('\n') || '- No workspaces are configured yet.';
  return `# Rel.AI MCP connector

Rel.AI targets MCP 2026-07-28. Requests are stateless at the protocol layer; logical work is owned by explicit Rel.AI task IDs and managed runtime handles.

## Workflow

Call \`relai_start_task\` once per independent objective. Use \`relai_repo_snapshot\`, \`relai_search\`, \`relai_semantic_search\`, \`relai_code_inspect\`, and \`relai_read\` only as needed. Use \`relai_process_*\` for persistent development commands and \`relai_worktree_*\` for isolated branches. Use \`relai_validation_plan\` for change-aware checks and \`relai_diagnostics_run\` for normalized compiler or analyzer output.

Use \`relai_edit\` as the single file mutation tool. Destructive actions may return \`input_required\`; retry with the accepted response and unchanged signed requestState. Long-running commands and checks can use \`defer:true\`; poll or cancel the returned operation handle with \`relai_operation_task_get\` and \`relai_operation_task_cancel\`.

Final completion requires \`relai_run_checks\` with \`complete:true\` and a summary, or \`relai_complete_task\` after post-validation read-only review.

## Configured workspaces

${workspaces}

## Server

- name: ${pkg.name}
- version: ${pkg.version}
- tool surface version: ${getToolSurfaceManifest().toolSurfaceVersion}
- protocol: 2026-07-28
- tool surface manifest: relai://server/tool-surface
`;
}

module.exports = { listResources, readResource, resourceCacheHint, resourceRevision };
