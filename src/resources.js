const { readConfig, publicConfigSummary } = require("./config");
const { collectTextFiles } = require("./safety");
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
    resources.push(resource(`relai://workspace/${encodeURIComponent(item.alias)}/profile`, `Workspace ${item.alias} Profile`, "Detected stack, manifests, commands, and test surface.", MIME_JSON));
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
  return `# Rel.AI MCP connector\n\nThis server exposes one local repo bridge workflow to ChatGPT. Prefer these tools over file search when the user asks to inspect or modify a configured workspace.\n\n## First calls to make\n\n1. Call \`relai_workspace_list\` to see configured aliases.\n2. Call \`relai_workspace_inspect\` with the requested alias, for example \`jjclover\`, to return the workspace profile and safe project tree in one response.\n3. For edits, create a task session and use the normal Rel.AI task workflow.\n\n## Configured workspaces\n\n${workspaces}\n\n## Server\n\n- name: ${pkg.name}\n- version: ${pkg.version}\n`;
}

module.exports = { listResources, readResource };
