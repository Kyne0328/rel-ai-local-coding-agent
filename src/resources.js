import * as path from 'node:path';
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { readConfig, publicConfigSummary, allWorkspaceAliases, resolveWorkspace } from "./config.js";
import { getToolSurfaceManifest } from "./tools.js";
import { workspaceProfile, workspaceTree, workspaceInspect, workspaceList } from "./tools/status.js";
import { packageMetadata as pkg } from './packageMetadata.js';
import { MCP_PROTOCOL_VERSION } from './mcp/protocol.js';

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
  if (parsed.kind === 'server' && parsed.name === 'tool-surface') return contents(uri, MIME_JSON, getToolSurfaceManifest(config), config);
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
  hash.update(pkg.version).update('\0').update(String(getToolSurfaceManifest(config).toolSurfaceVersion));
  hash.update('\0').update(String(uri || ''));
  hash.update('\0').update(stableJson(publicConfigSummary(config)));
  const parsed = parseRelaiUri(uri);
  if (parsed.kind === 'workspace' && parsed.workspace) {
    try {
      const workspace = resolveWorkspace(config, parsed.workspace);
      const stat = fs.statSync(workspace.path);
      hash.update('\0').update(workspace.path).update('\0').update(String(stat.mtimeMs));
      for (const relative of ['package.json', 'AGENTS.override.md', 'AGENTS.md', 'REL_AI.md', '.relai/instructions.md']) {
        try {
          const fileStat = fs.statSync(path.join(workspace.path, relative));
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

Rel.AI targets MCP ${MCP_PROTOCOL_VERSION}. Every request carries its own protocol version, client identity, and capabilities; no MCP transport session is created or used as task identity.

## Workflow

Call \`relai_work\` with action \`begin\` once per independent objective. Use \`relai_snapshot\`, \`relai_search\`, \`relai_inspect\`, and \`relai_read\` only as needed. Use \`relai_process\` for persistent commands, \`relai_worktree\` for isolated branches, and \`relai_validate\` for checks, diagnostics, or local HTTP probes.

Use \`relai_edit\` as the single file mutation tool. Destructive operations may return \`input_required\`; retry with the accepted response and integrity-protected requestState. Native asynchronous work is returned only when the current request advertises \`io.modelcontextprotocol/tasks\`, then polled with \`tasks/get\` and controlled with \`tasks/update\` or \`tasks/cancel\`.

Complete through \`relai_validate\` action \`checks\` with \`complete:true\` and a summary, or \`relai_work\` action \`finish\` after post-validation review.

## Configured workspaces

${workspaces}

## Server

- name: ${pkg.name}
- version: ${pkg.version}
- tool surface version: ${getToolSurfaceManifest(config).toolSurfaceVersion}
- tool profile: ${getToolSurfaceManifest(config).profile}
- protocol: ${MCP_PROTOCOL_VERSION}
- tool surface manifest: relai://server/tool-surface
`;
}

export { listResources, readResource, resourceCacheHint,  };
