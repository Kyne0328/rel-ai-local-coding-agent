const readline = require("node:readline");
const { getToolSchemas, getPublicToolSchemas, BRIDGE_TOOL_NAMES, PUBLIC_HTTP_TOOL_NAMES, callTool } = require("./tools");
const { readConfig } = require("./config");
const { listResources, readResource } = require("./resources");
const pkg = require("../package.json");

const MAX_TOOL_RESULT_CHARS = Number(process.env.REL_AI_MCP_MAX_TOOL_RESULT_CHARS || 120000);

function main() {
  const sessionState = {
    publicHttpOnly: false,
    publicCompatOnly: true
  };
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const message = JSON.parse(trimmed);
      if (Array.isArray(message)) {
        const responses = [];
        for (const item of message) {
          const response = await handleMessage(item, sessionState);
          if (response) responses.push(response);
        }
        if (responses.length > 0) write(responses);
        return;
      }
      const response = await handleMessage(message, sessionState);
      if (response) write(response);
    } catch (error) {
      write(jsonRpcError(null, -32700, "Parse error", error instanceof Error ? error.message : String(error)));
    }
  });
}

async function handleMessage(message, options = {}) {
  const publicHttpOnly = Boolean(options.publicHttpOnly);
  const publicCompatOnly = Boolean(options.publicCompatOnly);
  const publicOnly = publicHttpOnly || publicCompatOnly;
  const visibleTools = publicOnly ? getPublicToolSchemas() : getToolSchemas();
  if (!message || message.jsonrpc !== "2.0") {
    return jsonRpcError(message && message.id !== undefined ? message.id : null, -32600, "Invalid Request");
  }
  if (message.id === undefined) {
    await handleNotification(message);
    return null;
  }
  try {
    switch (message.method) {
      case "initialize": {
        const config = readConfig({ allowMissing: true });
        if (
          !publicHttpOnly &&
          Object.prototype.hasOwnProperty.call(message.params || {}, "protocolVersion") &&
          Number(config.sourceVersion || config.version || 0) >= 2
        ) {
          options.publicCompatOnly = false;
        } else if (!publicHttpOnly && options.publicCompatOnly) {
          // stdio clients silently get the stripped public surface on older configs;
          // surface why so a missing relai_edit etc. is diagnosable.
          console.error("[rel-ai-mcp] stdio compat mode: exposing the public tool surface only (config sourceVersion < 2). Re-run init-config to unlock the full tool set.");
        }
        return result(message.id, {
          protocolVersion: (message.params && message.params.protocolVersion) || "2025-06-18",
          capabilities: { tools: { listChanged: true }, resources: { subscribe: false, listChanged: true } },
          serverInfo: { name: pkg.name, version: pkg.version }
        });
      }
      case "ping":
        return result(message.id, {});
      case "tools/list":
        return result(message.id, { tools: visibleTools });
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
        if (publicOnly && BRIDGE_TOOL_NAMES.includes(name) && !PUBLIC_HTTP_TOOL_NAMES.includes(name)) {
          return result(message.id, toolResult({
            ok: false,
            error: `Tool '${name}' is not available on the public workspace-tool surface.`
          }, true));
        }
        try {
          const output = await callTool(name, args, { publicHttpOnly });
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
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    const preview = text.slice(0, MAX_TOOL_RESULT_CHARS) + "\n\n[rel-ai-mcp truncated tool result: " + text.length + " chars total]";
    return {
      content: [{ type: "text", text: preview }],
      structuredContent: compactToolResult(payload, text.length),
      isError: Boolean(isError)
    };
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: payload,
    isError: Boolean(isError)
  };
}

function compactToolResult(payload, originalChars) {
  if (!payload || typeof payload !== "object") return { ok: false, truncated: true, originalChars };
  return {
    ok: payload.ok !== false,
    truncated: true,
    originalChars,
    // Name the concrete lever so the model retries narrowly instead of guessing.
    message: "Result was truncated. Re-call with a narrower scope: relai_read { paths:[\"one/file\"], maxBytes } for a single file, a lower limit/maxBytes/maxEntries, or relai_diff { path } for one file's changes.",
    workspace: payload.workspace || null,
    sessionId: payload.sessionId || null,
    keys: Object.keys(payload).slice(0, 50)
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
