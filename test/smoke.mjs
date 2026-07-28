import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcpClient } from './helpers/mcp-client.mjs';
import { activeToolNames } from './helpers/tool-surface.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = startMcpClient({
  root,
  configPath: path.join(root, 'examples', 'config.example.json'),
  timeoutMs: 3000
});

try {
  client.discover(1);
  const discovery = await client.waitFor(1);
  if (!discovery.result?.capabilities?.tools) throw new Error('server/discover did not advertise tools capability');
  if (!discovery.result?.capabilities?.resources) throw new Error('server/discover did not advertise resources capability');
  if (!discovery.result?.supportedVersions?.includes('2026-07-28')) throw new Error('server/discover did not advertise MCP 2026-07-28');
  if (!String(discovery.result?.instructions || '').includes('relai_complete_task')) {
    throw new Error('server/discover did not advertise the explicit final-completion contract');
  }

  client.send(2, 'tools/list');
  const list = await client.waitFor(2);
  if (!Array.isArray(list.result?.tools) || list.result.tools.length !== activeToolNames.length) {
    throw new Error(`tools/list should expose ${activeToolNames.length} active workspace tools, got ${list.result?.tools?.length}`);
  }
  const names = list.result.tools.map(item => item.name).sort((a, b) => a.localeCompare(b));
  const expected = [...activeToolNames].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`Unexpected tool list: ${names.join(', ')}`);
  const editTool = list.result.tools.find(item => item.name === 'relai_edit');
  if (!editTool.inputSchema?.properties?.content || !editTool.inputSchema?.properties?.replacements || !editTool.inputSchema?.properties?.edits) throw new Error('relai_edit schema should expose content, replacement arrays, and batch edits');
  const readTool = list.result.tools.find(item => item.name === 'relai_read');
  if (!readTool.inputSchema?.properties?.startLine || !readTool.inputSchema?.properties?.endLine || !readTool.inputSchema?.properties?.guidanceMode) {
    throw new Error('relai_read schema should expose bounded line ranges and guidance mode');
  }

  client.send(3, 'resources/list');
  const resources = await client.waitFor(3);
  if (!Array.isArray(resources.result?.resources) || !resources.result.resources.some(item => item.uri === 'relai://server/workspaces')) {
    throw new Error('resources/list did not expose workspace resource');
  }

  console.log(`Smoke test passed. Tools: ${list.result.tools.length}`);
} finally {
  await client.close();
}
