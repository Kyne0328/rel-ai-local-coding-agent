#!/usr/bin/env node
const fs = require("node:fs");
const { startHttpServer } = require("../src/httpServer");
const { getConfigPath, makeDefaultConfig, writeConfig } = require("../src/config");
const connection = require("../src/connectionProfile");
const tunnelManager = require("../src/tunnelManager");

function parseArgs(argv) {
  const options = {};
  const readValue = (index, name) => {
    const value = argv[index + 1];
    if (!value || String(value).startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") options.host = readValue(i, arg), i += 1;
    else if (arg === "--port") options.port = Number(readValue(i, arg)), i += 1;
    else if (arg === "--token") options.token = readValue(i, arg), i += 1;
    else if (arg === "--public-url") options.publicUrl = readValue(i, arg), i += 1;
    else if (arg === "--public") {
      const next = argv[i + 1];
      if (next && !String(next).startsWith("--")) {
        options.tunnel = next;
        i += 1;
      } else {
        options.tunnel = "auto";
      }
    }
    else if (arg === "--tunnel") options.tunnel = readValue(i, arg), i += 1;
    else if (arg === "--cloudflare" || arg === "--cloudflared") options.tunnel = "cloudflare";
    else if (arg === "--ngrok") options.tunnel = "ngrok";
    else if (arg === "--localtunnel" || arg === "--lt") options.tunnel = "localtunnel";
    else if (arg === "--tunnel-command") options.tunnelCommand = readValue(i, arg), i += 1;
    else if (arg === "--tunnel-timeout-ms") options.tunnelTimeoutMs = Number(readValue(i, arg)), i += 1;
    else if (arg === "--reset-token") options.resetToken = true;
    else if (arg === "--show-token") options.showToken = true;
    else if (arg === "--print-only") options.printOnly = true;
    else if (arg === "--allow-no-auth") options.allowNoAuth = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!String(arg).startsWith("--") && !options.tunnel) {
      // Convenience form for npm users: npm run oneclick -- --public ngrok
      options.tunnel = arg;
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
  rel-ai-mcp-launch --public
  rel-ai-mcp-launch --public ngrok
  rel-ai-mcp-launch --tunnel cloudflare
  rel-ai-mcp-launch --tunnel ngrok
  rel-ai-mcp-launch --public-url https://relai.your-domain.com
  rel-ai-mcp-launch --print-only --show-token

Options:
  --host <host>          Bind host. Default: 127.0.0.1
  --port <port>          Bind port. Default: 3333
  --public [provider]    Start a temporary public tunnel automatically when possible.
                          Optional provider: cloudflare, ngrok, localtunnel, custom.
  --tunnel <provider>     Tunnel provider: auto, cloudflare, ngrok, localtunnel, custom, none.
  --ngrok                 Shortcut for --tunnel ngrok.
  --cloudflare            Shortcut for --tunnel cloudflare.
  --localtunnel           Shortcut for --tunnel localtunnel.
                          Default: auto when no stable public URL is configured.
  --tunnel-command <cmd>  Custom tunnel command. It must print an https:// URL.
  --tunnel-timeout-ms <n> Time to wait for tunnel URL. Default: 30000.
  --public-url <url>     Stable HTTPS base URL routed to this local server. Skips tunnel startup.
  --token <token>        Use this bearer token for this run.
  --reset-token          Generate and save a new local/API bearer token.
  --show-token           Print the local/API bearer token in connector summary output.
  --print-only           Print saved connector settings without starting the server.
  --allow-no-auth        Disable auth for local dashboard testing only.

Examples:
  rel-ai-mcp-launch --public
  rel-ai-mcp-launch --public ngrok
  rel-ai-mcp-launch --tunnel cloudflare
  rel-ai-mcp-launch --tunnel ngrok
  rel-ai-mcp-launch --tunnel custom --tunnel-command "your-tunnel http://127.0.0.1:3333"
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const createdConfig = ensureConfig();
  const savedProfile = connection.readConnectionProfile();
  const savedEnv = connection.readLaunchEnv();
  const host = options.host || process.env.REL_AI_MCP_HOST || savedProfile.host || "127.0.0.1";
  const port = Number(options.port || process.env.REL_AI_MCP_PORT || 3333);
  let publicUrl = connection.normalizePublicUrl(options.publicUrl || process.env.REL_AI_MCP_PUBLIC_URL || savedEnv.REL_AI_MCP_PUBLIC_URL || savedProfile.publicUrl || "");
  const token = resolveToken(options);
  const tunnelPreference = options.tunnel || process.env.REL_AI_MCP_TUNNEL || savedEnv.REL_AI_MCP_TUNNEL || (publicUrl ? "none" : "auto");
  const tunnelProvider = tunnelManager.normalizeTunnel(tunnelPreference);
  // When user explicitly requests a tunnel (--public/--tunnel/etc) without a stable --public-url,
  // discard the saved URL from the previous session so a fresh tunnel starts instead of reusing a stale one.
  if (options.tunnel && !options.publicUrl) publicUrl = "";
  const tunnelTimeoutMs = Number(options.tunnelTimeoutMs || process.env.REL_AI_MCP_TUNNEL_TIMEOUT_MS || savedEnv.REL_AI_MCP_TUNNEL_TIMEOUT_MS || 30000);
  const tunnelCommand = options.tunnelCommand || process.env.REL_AI_MCP_TUNNEL_COMMAND || savedEnv.REL_AI_MCP_TUNNEL_COMMAND || "";

  if (publicUrl) connection.writeLaunchEnv({ REL_AI_MCP_PUBLIC_URL: publicUrl });
  if (tunnelProvider !== "none") connection.writeLaunchEnv({ REL_AI_MCP_TUNNEL: tunnelProvider });
  if (tunnelCommand) connection.writeLaunchEnv({ REL_AI_MCP_TUNNEL_COMMAND: tunnelCommand });
  let profile = connection.writeConnectionProfile({ host, port, publicUrl, tunnelProvider, configPath: getConfigPath() });
  const summary = connection.buildConnectionSummary({ host: profile.host, port: profile.port, publicUrl: profile.publicUrl, token, showToken: options.showToken, tunnelProvider });

  if (createdConfig) console.error(`Created default config: ${getConfigPath()}`);
  connection.printConnectionSummary(summary);

  if (options.printOnly) return;

  const server = startHttpServer({ host, port, token, allowNoAuth: options.allowNoAuth, publicUrl });

  if (!publicUrl && tunnelProvider !== "none") {
    const localUrl = connection.localBaseUrl(host, port);
    console.error(`[rel-ai-mcp] Starting ${tunnelProvider} tunnel for ${localUrl} ...`);
    const tunnel = await tunnelManager.startTunnel({
      provider: tunnelProvider,
      port,
      localUrl,
      command: tunnelCommand,
      timeoutMs: tunnelTimeoutMs,
      onLog: (chunk, provider) => {
        const text = String(chunk || "").trim();
        if (text) console.error(`[rel-ai-mcp:${provider}] ${text}`);
      }
    });
    if (tunnel.ok) {
      publicUrl = connection.normalizePublicUrl(tunnel.publicUrl);
      connection.writeLaunchEnv({ REL_AI_MCP_PUBLIC_URL: publicUrl, REL_AI_MCP_TUNNEL: tunnel.provider });
      profile = connection.writeConnectionProfile({ host, port, publicUrl, tunnelProvider: tunnel.provider, tunnelCommand: tunnel.command || "", configPath: getConfigPath() });
      console.error("\n[rel-ai-mcp] Public tunnel is ready.");
      connection.printConnectionSummary(connection.buildConnectionSummary({ host: profile.host, port: profile.port, publicUrl: profile.publicUrl, token, showToken: options.showToken, tunnelProvider: tunnel.provider }));
      const stopTunnel = () => {
        if (tunnel.process && !tunnel.process.killed) tunnel.process.kill();
      };
      process.once("SIGINT", () => { stopTunnel(); server.close(() => process.exit(0)); });
      process.once("SIGTERM", () => { stopTunnel(); server.close(() => process.exit(0)); });
    } else {
      console.error(`[rel-ai-mcp] Tunnel startup failed: ${tunnel.error || "unknown error"}`);
      console.error("[rel-ai-mcp] ChatGPT connection requires HTTPS. Configure --public-url with a stable HTTPS URL, or fix the tunnel provider and restart.");
    }
  }
}

main().catch((error) => {
  console.error(`[rel-ai-mcp-launch] fatal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
