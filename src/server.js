const readline = require("node:readline");
const { toolSchemas, callTool } = require("./tools");
const { listResources, readResource } = require("./resources");
const pkg = require("../package.json");

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const message = JSON.parse(trimmed);
      if (Array.isArray(message)) {
        const responses = [];
        for (const item of message) {
          const response = await handleMessage(item);
          if (response) responses.push(response);
        }
        if (responses.length > 0) write(responses);
        return;
      }
      const response = await handleMessage(message);
      if (response) write(response);
    } catch (error) {
      write(jsonRpcError(null, -32700, "Parse error", error instanceof Error ? error.message : String(error)));
    }
  });
}

async function handleMessage(message) {
  if (!message || message.jsonrpc !== "2.0") {
    return jsonRpcError(message && message.id !== undefined ? message.id : null, -32600, "Invalid Request");
  }
  if (message.id === undefined) {
    await handleNotification(message);
    return null;
  }
  try {
    switch (message.method) {
      case "initialize":
        return result(message.id, {
          protocolVersion: (message.params && message.params.protocolVersion) || "2025-06-18",
          capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
          serverInfo: { name: pkg.name, version: pkg.version }
        });
      case "ping":
        return result(message.id, {});
      case "tools/list":
        return result(message.id, { tools: toolSchemas });
      case "resources/list":
        return result(message.id, listResources());
      case "resources/read": {
        const uri = message.params && message.params.uri;
        if (!uri) return jsonRpcError(message.id, -32602, "Missing resource uri.");
        return result(message.id, readResource(uri));
      }
      case "tools/call": {
        const params = message.params || {};
        const name = params.name;
        const args = params.arguments || {};
        if (!name) return jsonRpcError(message.id, -32602, "Missing tool name.");
        try {
          const output = await callTool(name, args);
          return result(message.id, toolResult(output, false));
        } catch (error) {
          const payload = {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
          return result(message.id, toolResult(payload, true));
        }
      }
      default:
        return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
    }
  } catch (error) {
    return jsonRpcError(message.id, -32603, "Internal error", error instanceof Error ? error.message : String(error));
  }
}

async function handleNotification(message) {
  if (message.method === "notifications/initialized" || message.method === "initialized") return;
  console.error(`[rel-ai-mcp] ignored notification: ${message.method}`);
}

function toolResult(payload, isError) {
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent: payload,
    isError: Boolean(isError)
  };
}

function result(id, value) {
  return { jsonrpc: "2.0", id, result: value };
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

module.exports = { main, handleMessage };
