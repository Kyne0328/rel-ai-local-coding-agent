'use strict';

const { serveStdio } = require('@modelcontextprotocol/server/stdio');
const { createRelaiMcpServer, SERVER_INSTANCE_ID } = require('./mcpServer');

function main() {
  return serveStdio(
    () => createRelaiMcpServer({ transportType: 'stdio' }),
    {
      onerror(error) {
        console.error(`[rel-ai-mcp] MCP stdio error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}

module.exports = { main, SERVER_INSTANCE_ID };
