import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { importNativeArtifact, normalizeReference, validateDownloadUrl } from '../src/artifactIntake.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-artifact-intake-'));
const repo = path.join(root, 'repo');
const config = { stateDir: path.join(root, 'state') };
const workspace = { alias: 'app', path: repo };
const originalFetch = globalThis.fetch;
fs.mkdirSync(repo, { recursive: true });

const file = {
  download_url: 'https://files.oaiusercontent.com/download/test-file',
  file_id: 'file_test_123',
  file_name: 'asset.bin',
  mime_type: 'application/octet-stream',
  size: 5
};

try {
  assert.equal(validateDownloadUrl(file.download_url), file.download_url);
  assert.throws(() => validateDownloadUrl('http://files.oaiusercontent.com/test'), /trusted OpenAI file host/i);
  assert.throws(() => validateDownloadUrl('https://example.com/test'), /trusted OpenAI file host/i);
  assert.throws(() => normalizeReference({ ...file, extra: true }), /malformed/i);

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(new Uint8Array([1, 2, 3, 4, 5]), {
      status: 200,
      headers: { 'content-length': '5', 'content-type': 'application/octet-stream' }
    });
  };

  const dryRun = await importNativeArtifact(workspace, config, { file, path: 'public/dry.bin', dryRun: true });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.changed, false);
  assert.equal(fetchCalls, 0, 'artifact dry-run must not perform network IO');
  assert.equal(fs.existsSync(path.join(repo, 'public', 'dry.bin')), false);

  const imported = await importNativeArtifact(workspace, config, { file, path: 'public/asset.bin' });
  assert.equal(fetchCalls, 1);
  assert.equal(imported.changed, true);
  assert.equal(imported.bytes, 5);
  assert.match(imported.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual([...fs.readFileSync(path.join(repo, 'public', 'asset.bin'))], [1, 2, 3, 4, 5]);

  await assert.rejects(
    () => importNativeArtifact(workspace, config, { file, path: 'public/asset.bin' }),
    /already exists/i,
    'artifact import must never overwrite an existing destination'
  );

  globalThis.fetch = async () => new Response(new Uint8Array([1, 2]), {
    status: 200,
    headers: { 'content-length': '2' }
  });
  await assert.rejects(
    () => importNativeArtifact(workspace, config, { file, path: 'public/wrong-size.bin' }),
    /metadata did not match/i
  );
  assert.equal(fs.existsSync(path.join(repo, 'public', 'wrong-size.bin')), false);

  console.log('Native ChatGPT artifact validation, dry-run, streamed import, size checks, and no-overwrite tests passed.');
} finally {
  globalThis.fetch = originalFetch;
  fs.rmSync(root, { recursive: true, force: true });
}
