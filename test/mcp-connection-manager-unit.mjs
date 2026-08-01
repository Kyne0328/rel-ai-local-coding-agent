import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpConnectionManager } from '../src/mcp/connectionManager.js';
import { buildToolManifest } from '../src/mcp/toolManifest.js';
import { resolveConnectionGenerations } from '../src/mcp/connectionGenerations.js';
import { runtimeMetadata } from '../src/runtimeCompatibility.js';

const neutralManifest = buildToolManifest({});
assert.equal(neutralManifest.version, buildToolManifest({}).version, 'neutral manifest must be deterministic');
assert.notEqual(
  neutralManifest.version,
  buildToolManifest({ workspaces: { repo: { path: process.cwd() } } }).version,
  'live manifests must detect client-visible workspace alias schema changes'
);
assert.equal(runtimeMetadata().manifestHash, neutralManifest.version, 'release compatibility must use the configuration-neutral manifest');

const generationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-connection-generations-'));
const generationFile = path.join(generationRoot, 'generations.json');
try {
  const first = resolveConnectionGenerations({}, {
    file: generationFile,
    key: Buffer.from('unit-test-key'),
    token: 'token-a',
    host: '127.0.0.1',
    port: 3333,
    publicUrl: 'https://example.ngrok.app'
  });
  const stable = resolveConnectionGenerations({}, {
    file: generationFile,
    key: Buffer.from('unit-test-key'),
    token: 'token-a',
    host: '127.0.0.1',
    port: 3333,
    publicUrl: 'https://example.ngrok.app'
  });
  const rotated = resolveConnectionGenerations({}, {
    file: generationFile,
    key: Buffer.from('unit-test-key'),
    token: 'token-b',
    host: '127.0.0.1',
    port: 3333,
    publicUrl: 'https://example.ngrok.app'
  });
  const reconfigured = resolveConnectionGenerations({}, {
    file: generationFile,
    key: Buffer.from('unit-test-key'),
    token: 'token-b',
    host: '127.0.0.1',
    port: 4444,
    publicUrl: 'https://example.ngrok.app'
  });
  assert.deepEqual(stable, first);
  assert.equal(rotated.credentialGeneration, first.credentialGeneration + 1);
  assert.equal(rotated.configurationGeneration, first.configurationGeneration);
  assert.equal(reconfigured.configurationGeneration, rotated.configurationGeneration + 1);
  assert.doesNotMatch(fs.readFileSync(generationFile, 'utf8'), /token-a|token-b/);
} finally {
  fs.rmSync(generationRoot, { recursive: true, force: true });
}

let now = 1_000;
const manager = new McpConnectionManager({ clock: () => now });
let changes = 0;
const unsubscribe = manager.onChange(() => { changes += 1; });
manager.configure({
  serverInstanceId: 'server-a',
  credentialGeneration: 1,
  configurationGeneration: 1,
  manifest: neutralManifest
});
assert.equal(manager.snapshot().status, 'starting');
manager.markReady();
assert.equal(manager.snapshot().status, 'ready');
assert.equal(manager.snapshot().requestModel, 'stateless');
assert.equal(manager.snapshot().connectedClientCount, 0);
assert.deepEqual(manager.snapshot().activeSessions, []);

now += 100;
manager.noteRequest({
  principal: 'sensitive-principal',
  method: 'server/discover',
  clientInfo: { name: 'test-client', version: '1.0.0' },
  clientCapabilities: {
    extensions: {
      'io.modelcontextprotocol/tasks': { secret: 'must-not-be-retained' }
    }
  }
});
manager.noteRequestResult('server/discover', true);
const afterRequest = manager.snapshot();
assert.equal(afterRequest.metrics.requestsReceived, 1);
assert.equal(afterRequest.metrics.requestsSucceeded, 1);
assert.equal(afterRequest.metrics.discoveryRequests, 1);
assert.notEqual(afterRequest.lastPrincipal, 'sensitive-principal');
assert.equal(JSON.stringify(afterRequest).includes('must-not-be-retained'), false);
assert.equal(JSON.stringify(afterRequest).includes('sensitive-principal'), false);

const changedManifest = { ...neutralManifest, version: 'changed-manifest', hash: 'changed-manifest-hash' };
assert.equal(await manager.observeManifest(changedManifest, 'tools/call'), true);
assert.equal(manager.snapshot().status, 'ready');
assert.equal(manager.snapshot().toolManifestVersion, changedManifest.version);
assert.equal(manager.snapshot().metrics.toolManifestChanges, 1);
assert.equal(await manager.observeManifest(changedManifest, 'tools/list'), false);

await manager.invalidateCredentials(2);
assert.equal(manager.snapshot().credentialGeneration, 2);
assert.equal(manager.snapshot().status, 'ready', 'credential rotation must not close nonexistent sessions');
assert.equal(manager.snapshot().manualRecoveryRequired, false);

const recovery = await manager.retryConnection('manual_retry');
assert.equal(recovery.ok, true);
assert.equal(recovery.stateless, true);
assert.equal(recovery.hostActionRequired, false);
assert.equal(manager.snapshot().lastRecoveryResult, 'not_required_stateless');

manager.markFailed(new Error('listen failed'));
assert.equal(manager.snapshot().status, 'failed');
await manager.shutdown('unit_shutdown');
assert.equal(manager.snapshot().status, 'stopped');
assert.equal(manager.snapshot().lastDisconnectReason, 'unit_shutdown');
assert.ok(changes > 0);
unsubscribe();

console.log('MCP stateless observability, manifest, generation, redaction, and no-session recovery tests passed.');
