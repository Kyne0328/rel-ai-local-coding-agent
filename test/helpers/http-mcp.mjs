export const MCP_VERSION = '2026-07-28';

export function requestMeta(clientName = 'relai-http-test', capabilities = {}) {
  return {
    'io.modelcontextprotocol/protocolVersion': MCP_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: clientName, version: '2026.7.28' },
    'io.modelcontextprotocol/clientCapabilities': capabilities
  };
}

export function mcpHeaders(method, { token = '', name = '', extra = {} } = {}) {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': MCP_VERSION,
    'mcp-method': method,
    ...(name ? { 'mcp-name': name } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra
  };
}

export function mcpBody(id, method, params = {}, clientName, capabilities = {}) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params: { ...params, _meta: requestMeta(clientName, capabilities) }
  });
}

export async function readMcpResponse(response) {
  const text = await response.text();
  if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
    const frames = text.split(/\n\n+/).map(frame => frame.trim()).filter(Boolean);
    const data = frames.flatMap(frame => frame.split(/\r?\n/))
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .filter(Boolean);
    if (!data.length) throw new Error(`MCP SSE response contained no data: ${text}`);
    return JSON.parse(data.at(-1));
  }
  return JSON.parse(text);
}

export async function postMcp(base, { id, method, params = {}, token = '', name = '', clientName, capabilities = {}, extraHeaders = {} }) {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: mcpHeaders(method, { token, name, extra: extraHeaders }),
    body: mcpBody(id, method, params, clientName, capabilities)
  });
  return { response, body: await readMcpResponse(response) };
}
