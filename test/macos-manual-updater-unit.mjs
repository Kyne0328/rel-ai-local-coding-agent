import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CHECKSUM_ASSET_NAME, RELEASES_API_URL, checksumFor, createMacManualUpdater, parseRelease } from '../electron/macos-manual-updater.js';

const roots = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-macos-updater-'));
  roots.push(root);
  return root;
}

function releaseFixture(version, arch, bytes, overrides = {}) {
  const assetName = `Rel.AI-MCP-${version}-mac-${arch}.dmg`;
  const assetUrl = `https://github.com/Kyne0328/rel-ai-chatgpt-web-harness/releases/download/${version}/${assetName}`;
  const checksumUrl = `https://github.com/Kyne0328/rel-ai-chatgpt-web-harness/releases/download/${version}/${CHECKSUM_ASSET_NAME}`;
  return {
    assetName,
    assetUrl,
    checksumUrl,
    payload: {
      tag_name: version,
      draft: false,
      prerelease: false,
      published_at: '2026-08-29T00:00:00.000Z',
      body: 'macOS update notes',
      assets: [
        { name: assetName, browser_download_url: assetUrl, size: bytes.length },
        { name: CHECKSUM_ASSET_NAME, browser_download_url: checksumUrl, size: 200 }
      ],
      ...overrides
    }
  };
}

const root = tempRoot();
const version = '0.28.0';
const bytes = Buffer.from('verified fake dmg bytes');
const fixture = releaseFixture(version, 'x64', bytes);
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const checksumBody = `${digest}  ${fixture.assetName}\n`;
const fetchCalls = [];
let openedPath = '';
const progress = [];

const updater = createMacManualUpdater({
  app: { getPath: name => { assert.equal(name, 'userData'); return root; } },
  arch: 'x64',
  fetchImpl: async url => {
    fetchCalls.push(String(url));
    if (url === RELEASES_API_URL) return new Response(JSON.stringify(fixture.payload), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === fixture.checksumUrl) return new Response(checksumBody, { status: 200 });
    if (url === fixture.assetUrl) return new Response(bytes, { status: 200 });
    return new Response('not found', { status: 404 });
  },
  openPath: async file => { openedPath = file; return ''; },
  now: (() => { let value = 1_000; return () => (value += 100); })()
});

const release = await updater.checkForUpdates();
assert.equal(release.version, version);
assert.equal(release.assetName, fixture.assetName);
assert.equal(release.releaseNotes, 'macOS update notes');

const downloaded = await updater.downloadUpdate({ version, onProgress: value => progress.push(value) });
assert.equal(downloaded.assetName, fixture.assetName);
const expectedPath = path.join(root, 'updates', fixture.assetName);
assert.equal(fs.readFileSync(expectedPath).toString(), bytes.toString());
assert.ok(progress.length >= 1, 'download must publish progress');
assert.equal(progress.at(-1).percent, 100);
assert.equal(fetchCalls.filter(url => url === fixture.assetUrl).length, 1);

await updater.downloadUpdate({ version, onProgress: value => progress.push(value) });
assert.equal(fetchCalls.filter(url => url === fixture.assetUrl).length, 1, 'a verified cached DMG must not be downloaded again');

const opened = await updater.openDownloaded(version);
assert.equal(opened.ok, true);
assert.equal(opened.assetName, fixture.assetName);
assert.equal(openedPath, expectedPath);

const armFixture = releaseFixture(version, 'arm64', bytes);
assert.equal(parseRelease(armFixture.payload, 'arm64').assetName, armFixture.assetName, 'Apple Silicon must select the arm64 DMG');
assert.equal(checksumFor(checksumBody, fixture.assetName), digest);

const badRoot = tempRoot();
const badFixture = releaseFixture('0.28.1', 'x64', bytes);
const badUpdater = createMacManualUpdater({
  app: { getPath: () => badRoot },
  arch: 'x64',
  fetchImpl: async url => {
    if (url === RELEASES_API_URL) return new Response(JSON.stringify(badFixture.payload), { status: 200 });
    if (url === badFixture.checksumUrl) return new Response(`${'0'.repeat(64)}  ${badFixture.assetName}\n`, { status: 200 });
    if (url === badFixture.assetUrl) return new Response(bytes, { status: 200 });
    return new Response('not found', { status: 404 });
  },
  openPath: async () => ''
});
await badUpdater.checkForUpdates();
await assert.rejects(() => badUpdater.downloadUpdate({ version: '0.28.1' }), /SHA-256 verification/);
assert.equal(fs.existsSync(path.join(badRoot, 'updates', badFixture.assetName)), false, 'checksum failure must not promote the downloaded DMG');

const untrusted = releaseFixture('0.28.2', 'x64', bytes);
untrusted.payload.assets[0].browser_download_url = 'https://example.com/Rel.AI-MCP-0.28.2-mac-x64.dmg';
assert.throws(() => parseRelease(untrusted.payload, 'x64'), /untrusted download URL/i);

for (const candidate of [
  { tag_name: 'v0.28.0-beta.1', assets: [] },
  { tag_name: '0.28.0', draft: true, assets: [] },
  { tag_name: '0.28.0', prerelease: true, assets: [] }
]) {
  assert.throws(() => parseRelease(candidate, 'x64'));
}

for (const item of roots) fs.rmSync(item, { recursive: true, force: true });
console.log('macOS manual updater unit tests passed.');
