import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePlugin } from '../scripts/validate-plugin.mjs';
import { startMcpClient, structuredContentOf } from './helpers/mcp-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-plugin-package-'));
const packDir = path.join(temp, 'pack');
const extractDir = path.join(temp, 'extract');
const installDir = path.join(temp, 'installed', 'rel-ai-mcp');
fs.mkdirSync(packDir, { recursive: true });
fs.mkdirSync(extractDir, { recursive: true });

try {
  const sourceValidation = validatePlugin(root);
  assert.equal(sourceValidation.ok, true);

  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', packDir], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    shell: process.platform === 'win32'
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const parsedMetadata = JSON.parse(packed.stdout);
  const metadata = Array.isArray(parsedMetadata) ? parsedMetadata[0] : Object.values(parsedMetadata)[0];
  assert.ok(metadata?.filename, `npm pack returned no artifact metadata: ${packed.stdout}`);
  const artifact = path.join(packDir, metadata.filename);
  assert.ok(fs.existsSync(artifact), 'npm pack artifact must exist');

  const tar = spawnSync('tar', ['-xzf', artifact, '-C', extractDir], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(tar.status, 0, tar.stderr || tar.stdout);
  const builtRoot = path.join(extractDir, 'package');
  assert.equal(validatePlugin(builtRoot, { requireDirectoryName: false }).ok, true);

  const expected = [
    '.codex-plugin/plugin.json', '.mcp.json', 'skills/rel-ai-workflow/SKILL.md',
    'skills/rel-ai-workflow/agents/openai.yaml', 'skills/rel-ai-workflow/references/workflows.md',
    'skills/rel-ai-workflow/references/safety.md', 'bin/rel-ai-mcp.js', 'package.json'
  ];
  const packedFiles = new Set(metadata.files.map(item => item.path.replaceAll('\\', '/')));
  for (const relative of expected) assert.ok(packedFiles.has(relative), `artifact missing ${relative}`);
  for (const dependency of ['@modelcontextprotocol/server', '@opentelemetry/api']) {
    assert.ok(
      fs.existsSync(path.join(builtRoot, 'node_modules', dependency, 'package.json')),
      `artifact must bundle runtime dependency ${dependency}`
    );
  }

  fs.mkdirSync(path.dirname(installDir), { recursive: true });
  fs.cpSync(builtRoot, installDir, { recursive: true });
  assert.equal(validatePlugin(installDir).ok, true, 'installed plugin must validate');
  const mcp = JSON.parse(fs.readFileSync(path.join(installDir, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers['rel-ai-mcp'], {
    command: 'node',
    args: ['./bin/rel-ai-mcp.js'],
    cwd: '.'
  });
  const check = spawnSync(process.execPath, ['--check', path.join(installDir, 'bin', 'rel-ai-mcp.js')], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);

  const configPath = path.join(temp, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    version: 2,
    toolProfile: 'compact',
    stateDir: path.join(temp, 'state'),
    patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
    workspaces: { repo: { path: root } }
  }, null, 2));
  const client = startMcpClient({ root: installDir, configPath, timeoutMs: 15_000 });
  try {
    client.initialize(1);
    const discovery = await client.waitFor(1);
    assert.equal(discovery.result?.capabilities?.tools != null, true, 'installed MCP server must advertise tools');
    client.send(2, 'tools/list');
    const listed = await client.waitFor(2);
    assert.equal(listed.result?.tools?.length, 12, 'installed MCP server must expose the compact tool surface');
    assert.equal(listed.result.tools.some(tool => tool.name === 'relai_work'), true);
    client.call(3, 'relai_work', { action: 'begin', workspace: root, bootstrap: 'none' });
    const started = structuredContentOf(await client.waitFor(3));
    assert.match(started.work_id, /^[0-9a-f-]{36}$/i, 'installed MCP server must start work through relai_work begin');
    client.call(4, 'relai_work', { action: 'cancel', work_id: started.work_id, reason: 'Package startup test completed.' });
    const cancelled = structuredContentOf(await client.waitFor(4));
    assert.equal(cancelled.work_id, started.work_id);
  } finally {
    await client.close();
  }

  fs.rmSync(installDir, { recursive: true, force: true });
  assert.equal(fs.existsSync(installDir), false, 'plugin removal must remove the complete unit');

  console.log(`Plugin artifact ${path.basename(artifact)} validated, installed, and removed.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
