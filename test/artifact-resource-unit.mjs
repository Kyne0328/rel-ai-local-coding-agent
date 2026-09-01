import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CallToolResultSchema, ReadResourceResultSchema } from '@modelcontextprotocol/core';
import { createHttpMcpSession } from './helpers/http-mcp.mjs';
import { startHttpTestServer, stopHttpTestServer } from './helpers/http-test-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-artifact-resource-'));
const workspace = path.join(temp, 'workspace');
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
const token = 'artifact-resource-token';
const bytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]),
  crypto.createHash('sha256').update('relai-artifact-resource').digest(),
  Buffer.from([0x00, 0xff, 0x01, 0x02, 0x03])
]);

fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(path.join(workspace, 'round-trip.zip'), bytes);
fs.writeFileSync(configPath, `${JSON.stringify({
  version: 7,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  telemetry: { enabled: false },
  processEnvironment: { allow: [] },
  workspaces: {
    artifact: {
      path: workspace,
      repoSlug: '',
      context: { snapshotMaxFiles: 100, includeRoots: [], excludePaths: [] },
      validationRules: {}
    }
  }
}, null, 2)}\n`);

const { child, base } = await startHttpTestServer({ root, configPath, token, stateDir });
let client;
try {
  client = await createHttpMcpSession(base, { token, clientName: 'relai-artifact-resource-test' });
  const started = await client.request('tools/call', {
    name: 'relai_work',
    arguments: { action: 'begin', workspace: 'artifact', bootstrap: 'none' }
  });
  assert.equal(started.body.result?.isError, false, JSON.stringify(started.body));
  const workId = started.body.result?.structuredContent?.work_id;
  assert.match(workId || '', /^[0-9a-f-]{36}$/i);

  const linked = await client.request('tools/call', {
    name: 'relai_read',
    arguments: { work_id: workId, paths: ['round-trip.zip'], asResource: true }
  });
  assert.equal(linked.response.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.result?.isError, false, JSON.stringify(linked.body));
  assert.equal(CallToolResultSchema.safeParse(linked.body.result).success, true, JSON.stringify(linked.body.result));
  const resourceLink = linked.body.result?.content?.find(item => item?.type === 'resource_link');
  assert.ok(resourceLink, 'relai_read asResource must emit a standard MCP resource_link content block');
  assert.match(resourceLink.uri || '', /^relai:\/\/artifact\/[A-Za-z0-9_-]+$/);
  assert.equal(resourceLink.name, 'round-trip.zip');
  assert.equal(resourceLink.mimeType, 'application/zip');
  assert.equal(resourceLink.size, bytes.length);
  assert.equal(linked.body.result?.structuredContent?.items?.[0]?.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(linked.body.result?.structuredContent?.items?.[0]?.resourceUri, resourceLink.uri);

  const read = await client.request('resources/read', { uri: resourceLink.uri });
  assert.equal(read.response.status, 200, JSON.stringify(read.body));
  assert.equal(ReadResourceResultSchema.safeParse(read.body.result).success, true, JSON.stringify(read.body.result));
  const resource = read.body.result?.contents?.[0];
  assert.equal(resource?.mimeType, 'application/zip');
  assert.deepEqual(Buffer.from(resource?.blob || '', 'base64'), bytes, 'artifact resource bytes must round-trip exactly through MCP');

  const tamperedUri = `${resourceLink.uri.slice(0, -1)}${resourceLink.uri.endsWith('A') ? 'B' : 'A'}`;
  const tampered = await client.request('resources/read', { uri: tamperedUri });
  assert.ok(tampered.body.error, 'tampered artifact tokens must be rejected');

  const cancelled = await client.request('tools/call', {
    name: 'relai_work',
    arguments: { action: 'cancel', work_id: workId, reason: 'Artifact resource test completed.' }
  });
  assert.equal(cancelled.body.result?.isError, false, JSON.stringify(cancelled.body));
} finally {
  if (client) await client.close().catch(() => {});
  await stopHttpTestServer(child);
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Task-bound MCP artifact resource_link and binary resources/read round-trip passed.');
