import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePlugin } from '../scripts/validate-plugin.mjs';
import { getPublicToolSchemas } from '../src/tools/schema.js';
import { startMcpClient, structuredContentOf } from './helpers/mcp-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-plugin-package-'));
const packDir = path.join(temp, 'pack');
const extractDir = path.join(temp, 'extract');
const installDir = path.join(temp, 'installed', 'rel-ai-mcp');
const expectedSkills = ['rel-ai-debugging', 'rel-ai-dev-process', 'rel-ai-investigation', 'rel-ai-verification', 'rel-ai-workflow'];
fs.mkdirSync(packDir, { recursive: true });
fs.mkdirSync(extractDir, { recursive: true });

try {
  const sourceValidation = validatePlugin(root);
  assert.equal(sourceValidation.ok, true);
  assert.deepEqual(sourceValidation.skills, expectedSkills);

  const npmArgs = ['pack', '--json', '--pack-destination', packDir];
  const npmCli = resolveNpmCli();
  const packed = npmCli
    ? spawnSync(process.execPath, [npmCli, ...npmArgs], {
        cwd: root, encoding: 'utf8', timeout: 120_000, shell: false
      })
    : process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm pack --json --pack-destination "${packDir}"`], {
          cwd: root, encoding: 'utf8', timeout: 120_000, shell: false
        })
      : spawnSync('npm', npmArgs, {
          cwd: root, encoding: 'utf8', timeout: 120_000, shell: false
        });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const parsedMetadata = JSON.parse(packed.stdout);
  const metadata = Array.isArray(parsedMetadata) ? parsedMetadata[0] : Object.values(parsedMetadata)[0];
  assert.ok(metadata?.filename, `npm pack returned no artifact metadata: ${packed.stdout}`);
  assert.ok(Number(metadata.size) < 6_000_000, `compressed plugin package is ${metadata.size} bytes`);
  assert.ok(Number(metadata.unpackedSize) < 35_000_000, `unpacked plugin package is ${metadata.unpackedSize} bytes`);
  const artifact = path.join(packDir, metadata.filename);
  assert.ok(fs.existsSync(artifact), 'npm pack artifact must exist');

  const tar = spawnSync('tar', ['-xzf', artifact, '-C', extractDir], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(tar.status, 0, tar.stderr || tar.stdout);
  const builtRoot = path.join(extractDir, 'package');
  const builtValidation = validatePlugin(builtRoot, { requireDirectoryName: false });
  assert.deepEqual(builtValidation.skills, expectedSkills);

  const expected = [
    '.codex-plugin/plugin.json', '.mcp.json', 'skills/PROVENANCE.md',
    ...expectedSkills.flatMap(skill => [`skills/${skill}/SKILL.md`, `skills/${skill}/agents/openai.yaml`]),
    'skills/rel-ai-workflow/references/workflows.md', 'skills/rel-ai-workflow/references/safety.md',
    'bin/rel-ai-mcp.js', 'package.json'
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
  assert.deepEqual(validatePlugin(installDir).skills, expectedSkills, 'installed plugin skills must validate');
  const mcp = JSON.parse(fs.readFileSync(path.join(installDir, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers['rel-ai-mcp'], {
    command: 'node', args: ['./bin/rel-ai-mcp.js'], cwd: '.'
  });
  const check = spawnSync(process.execPath, ['--check', path.join(installDir, 'bin', 'rel-ai-mcp.js')], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);

  const config = {
    version: 3,
    stateDir: path.join(temp, 'state'),
    patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
    workspaces: { repo: { path: root } }
  };
  const configPath = path.join(temp, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  const client = startMcpClient({ root: installDir, configPath, timeoutMs: 30_000 });
  try {
    client.initialize(1);
    const discovery = await client.waitFor(1);
    assert.equal(discovery.result?.capabilities?.tools != null, true, 'installed MCP server must advertise tools');
    assert.deepEqual(discovery.result?.capabilities?.extensions?.['io.modelcontextprotocol/tasks'], {});

    client.send(2, 'tools/list');
    const listed = await client.waitFor(2);
    assert.equal(listed.result?.tools?.length, 12, 'installed MCP server must expose the unified 12-tool surface');
    assert.deepEqual(listed.result.tools, getPublicToolSchemas(config), 'source and extracted tools/list must match');

    client.call(3, 'relai_work', { action: 'begin', workspace: root, bootstrap: 'none' });
    const started = structuredContentOf(await client.waitFor(3));
    assert.match(started.work_id, /^[0-9a-f-]{36}$/i, 'installed MCP server must start work through relai_work begin');

    client.call(4, 'relai_read', {
      work_id: started.work_id,
      paths: ['package.json'],
      maxBytes: 32768,
      guidanceMode: 'none'
    });
    const read = structuredContentOf(await client.waitFor(4));
    assert.equal(read.items?.[0]?.path, 'package.json', 'installed artifact must execute a low-risk repository read');

    client.call(5, 'relai_validate', {
      action: 'checks',
      work_id: started.work_id,
      check: 'node --check src/mcpServer.js',
      timeoutMs: 30000,
      stopOnFailure: true
    });
    const validation = structuredContentOf(await client.waitFor(5, 45_000));
    assert.equal(validation.ok, true, 'consolidated validation must receive work_id in the extracted artifact');

    client.call(6, 'relai_process', { action: 'list', work_id: started.work_id });
    const processes = structuredContentOf(await client.waitFor(6));
    assert.equal(processes.ok, true, 'consolidated process listing must receive work_id in the extracted artifact');
    assert.equal(processes.count, 0);

    client.call(7, 'relai_work', { action: 'cancel', work_id: started.work_id, reason: 'Package runtime parity test completed.' });
    const cancelled = structuredContentOf(await client.waitFor(7));
    assert.equal(cancelled.work_id, started.work_id);
  } finally {
    await client.close();
  }

  fs.rmSync(installDir, { recursive: true, force: true });
  assert.equal(fs.existsSync(installDir), false, 'plugin removal must remove the complete unit');
  console.log(`Plugin artifact ${path.basename(artifact)} validated, installed, exercised, and removed.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  return candidates.map(value => String(value || '')).find(value => value && fs.existsSync(value)) || '';
}
