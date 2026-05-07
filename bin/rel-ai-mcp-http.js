#!/usr/bin/env node
const { startHttpServer } = require("../src/httpServer");

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") options.host = argv[++i];
    else if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--token") options.token = argv[++i];
    else if (arg === "--chatgpt-secret") options.chatgptSecret = argv[++i];
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
  console.log(`rel-ai-mcp-http\n\nUsage:\n  REL_AI_MCP_TOKEN=... rel-ai-mcp-http --host 127.0.0.1 --port 3333\n\nOptions:\n  --host <host>          Bind host. Default: 127.0.0.1\n  --port <port>          Bind port. Default: 3333\n  --token <token>        Bearer token. Prefer REL_AI_MCP_TOKEN.\n  --allow-no-auth        Disable auth for local testing only.\n`);
}

try {
  startHttpServer(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`[rel-ai-mcp-http] fatal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
}
