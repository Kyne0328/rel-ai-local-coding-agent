#!/usr/bin/env node
const fs = require("node:fs");
const { startHttpServer } = require("../src/httpServer");
const { getConfigPath, makeDefaultConfig, writeConfig } = require("../src/config");
const connection = require("../src/connectionProfile");

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") options.host = argv[++i];
    else if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--token") options.token = argv[++i];
    else if (arg === "--public-url") options.publicUrl = argv[++i];
    else if (arg === "--reset-token") options.resetToken = true;
    else if (arg === "--show-token") options.showToken = true;
    else if (arg === "--print-only") options.printOnly = true;
    else if (arg === "--allow-no-auth") options.allowNoAuth = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`rel-ai-mcp-launch

One-command launcher for Rel.AI MCP.

Usage:
  rel-ai-mcp-launch
  rel-ai-mcp-launch --public-url https://relai.your-domain.com
  rel-ai-mcp-launch --print-only --show-token

Options:
  --host <host>          Bind host. Default: 127.0.0.1
  --port <port>          Bind port. Default: 3333
  --public-url <url>     Stable HTTPS base URL routed to this local server.
  --token <token>        Use this bearer token for this run.
  --reset-token          Generate and save a new token.
  --show-token           Print the token in connector summary output.
  --print-only           Print saved connector settings without starting the server.
  --allow-no-auth        Disable auth for local-only testing.
`);
}

function ensureConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) return false;
  writeConfig(makeDefaultConfig(), { overwrite: false });
  return true;
}

function resolveToken(options) {
  if (options.allowNoAuth) return "";
  if (options.token) {
    connection.writeLaunchEnv({ REL_AI_MCP_TOKEN: options.token });
    return options.token;
  }
  if (process.env.REL_AI_MCP_TOKEN && !options.resetToken) return process.env.REL_AI_MCP_TOKEN;
  const saved = connection.readLaunchEnv();
  if (saved.REL_AI_MCP_TOKEN && !options.resetToken) return saved.REL_AI_MCP_TOKEN;
  const token = connection.generateToken();
  connection.writeLaunchEnv({ REL_AI_MCP_TOKEN: token });
  return token;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const createdConfig = ensureConfig();
  const savedProfile = connection.readConnectionProfile();
  const savedEnv = connection.readLaunchEnv();
  const host = options.host || process.env.REL_AI_MCP_HOST || savedProfile.host || "127.0.0.1";
  const port = Number(options.port || process.env.REL_AI_MCP_PORT || savedProfile.port || 3333);
  const publicUrl = connection.normalizePublicUrl(options.publicUrl || process.env.REL_AI_MCP_PUBLIC_URL || savedEnv.REL_AI_MCP_PUBLIC_URL || savedProfile.publicUrl || "");
  const token = resolveToken(options);

  if (publicUrl) connection.writeLaunchEnv({ REL_AI_MCP_PUBLIC_URL: publicUrl });
  const profile = connection.writeConnectionProfile({ host, port, publicUrl, configPath: getConfigPath() });
  const summary = connection.buildConnectionSummary({ host: profile.host, port: profile.port, publicUrl: profile.publicUrl, token, showToken: options.showToken });

  if (createdConfig) console.error(`Created default config: ${getConfigPath()}`);
  connection.printConnectionSummary(summary);

  if (options.printOnly) return;

  startHttpServer({ host, port, token, allowNoAuth: options.allowNoAuth, publicUrl });
}

try {
  main();
} catch (error) {
  console.error(`[rel-ai-mcp-launch] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
