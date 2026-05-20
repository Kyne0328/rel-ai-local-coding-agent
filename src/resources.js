const { readConfig, publicConfigSummary } = require("./config");
const { workspaceProfile, workspaceTree, workspaceInspect, workspaceList } = require("./tools");
const pkg = require("../package.json");

const MIME_JSON = "application/json";
const MIME_MARKDOWN = "text/markdown";

function listResources() {
  const config = readConfig();
  const resources = [
    resource("relai://server/help", "Rel.AI MCP Help", "How ChatGPT should use this Rel.AI MCP server.", MIME_MARKDOWN),
    resource("relai://server/config", "Rel.AI MCP Config Summary", "Safe connector configuration summary without secrets.", MIME_JSON),
    resource("relai://server/workspaces", "Rel.AI MCP Workspaces", "Configured workspace aliases and safe metadata.", MIME_JSON)
  ];
  for (const item of workspaceList(config).workspaces) {
    resources.push(resource(`relai://workspace/${encodeURIComponent(item.alias)}/inspect`, `Workspace ${item.alias} Inspect`, "Combined workspace profile and filtered project structure.", MIME_JSON));
    resources.push(resource(`relai://workspace/${encodeURIComponent(item.alias)}/profile`, `Workspace ${item.alias} Profile`, "Detected stack, manifests, checks, and test surface.", MIME_JSON));
    resources.push(resource(`relai://workspace/${encodeURIComponent(item.alias)}/tree`, `Workspace ${item.alias} Tree`, "Safe filtered file tree for the workspace.", MIME_JSON));
  }
  return { resources };
}

function readResource(uri) {
  const config = readConfig();
  const parsed = parseRelaiUri(uri);
  if (parsed.kind === "server" && parsed.name === "help") {
    return contents(uri, MIME_MARKDOWN, helpMarkdown(config));
  }
  if (parsed.kind === "server" && parsed.name === "config") {
    return contents(uri, MIME_JSON, publicConfigSummary(config));
  }
  if (parsed.kind === "server" && parsed.name === "workspaces") {
    return contents(uri, MIME_JSON, workspaceList(config));
  }
  if (parsed.kind === "workspace") {
    const args = { workspace: parsed.workspace, maxEntries: 800 };
    if (parsed.name === "inspect") return contents(uri, MIME_JSON, workspaceInspect(config, args));
    if (parsed.name === "profile") return contents(uri, MIME_JSON, workspaceProfile(config, args));
    if (parsed.name === "tree") return contents(uri, MIME_JSON, workspaceTree(config, args));
  }
  throw new Error(`Unknown resource: ${uri}`);
}

function parseRelaiUri(uri) {
  const text = String(uri || "").trim();
  if (!text.startsWith("relai://")) throw new Error(`Unsupported resource URI: ${text}`);
  const withoutScheme = text.slice("relai://".length);
  const parts = withoutScheme.split("/").map((part) => decodeURIComponent(part));
  if (parts[0] === "server") return { kind: "server", name: parts[1] || "" };
  if (parts[0] === "workspace") return { kind: "workspace", workspace: parts[1] || "", name: parts[2] || "" };
  throw new Error(`Unsupported resource URI: ${text}`);
}

function resource(uri, name, description, mimeType) {
  return { uri, name, description, mimeType };
}

function contents(uri, mimeType, value) {
  const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  return { contents: [{ uri, mimeType, text }] };
}

function helpMarkdown(config) {
  const workspaces = workspaceList(config).workspaces.map((item) => `- ${item.alias}: ${item.path}`).join("\n") || "- No workspaces are configured yet.";
  return `# Rel.AI MCP connector

This server exposes one peer-level workspace-tool surface to ChatGPT. Tool choice is based on task shape and file size.

## First calls to make

1. Call \`relai_repo_snapshot\` with the requested alias, for example \`jjclover\`, to return the workspace profile, safe project tree, and size-based write guidance.
2. For edits, use only the workspace workflow: \`relai_read\` exact files, then choose the smallest fitting change tool:
   - \`relai_replace\` for small exact edits inside existing files, especially large/interpolation-heavy Dart or source files.
   - direct \`relai_write\` for complete replacement of small or normal-sized files.
   - staged \`relai_write\` for complete replacement of larger files.
   - \`relai_apply_update\` when a change is naturally patch-shaped across files.
   - \`relai_apply_bundle\` when a prepared file bundle should overlay many files.
   - \`relai_clear_files\` for obsolete files.
3. After edits, run \`relai_run_checks\`, then \`relai_diff\` for review.
4. If a full-file or staged payload is too large, re-read the target and use smaller \`relai_replace\` operations with exact current text.
5. If ChatGPT still shows removed tools, restart/reconnect the MCP server instead of falling back.

## Configured workspaces

${workspaces}

## Server

- name: ${pkg.name}
- version: ${pkg.version}
`;
}

module.exports = { listResources, readResource };
