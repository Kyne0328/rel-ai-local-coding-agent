import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const RELEASES_API_URL = 'https://api.github.com/repos/Kyne0328/rel-ai-mcp/releases/latest';
const RELEASE_DOWNLOAD_PREFIX = '/Kyne0328/rel-ai-mcp/releases/download/';
const CHECKSUM_ASSET_NAME = 'SHA256SUMS.txt';
const MAX_CHECKSUM_BYTES = 1024 * 1024;

function createMacManualUpdater(options = {}) {
  const {
    app,
    arch = process.arch,
    fetchImpl = globalThis.fetch,
    openPath,
    now = () => Date.now(),
    onLog = () => {}
  } = options;
  if (!app || typeof app.getPath !== 'function') throw new TypeError('Electron app is required for macOS updates.');
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported macOS update architecture: ${arch}.`);
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required for macOS updates.');
  if (typeof openPath !== 'function') throw new TypeError('A file opener is required for macOS updates.');

  let release = null;
  let downloadedPath = '';

  async function checkForUpdates() {
    const response = await fetchTrusted(RELEASES_API_URL, 'GitHub release metadata', fetchImpl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Rel.AI-MCP-Updater'
      }
    });
    const payload = await response.json();
    release = parseRelease(payload, arch);
    downloadedPath = '';
    return publicRelease(release);
  }

  async function downloadUpdate({ version, onProgress = () => {} } = {}) {
    const requestedVersion = String(version || '').trim();
    if (!release || release.version !== requestedVersion) {
      throw new Error('macOS update metadata is stale. Check for updates again before downloading.');
    }

    const checksumResponse = await fetchTrusted(release.checksumUrl, 'release checksum manifest', fetchImpl, {
      headers: { 'User-Agent': 'Rel.AI-MCP-Updater' }
    });
    const checksumText = await boundedText(checksumResponse, MAX_CHECKSUM_BYTES);
    const expectedSha256 = checksumFor(checksumText, release.assetName);
    if (!expectedSha256) throw new Error(`Release checksum metadata does not contain ${release.assetName}.`);

    const updateDirectory = path.join(app.getPath('userData'), 'updates');
    const target = path.join(updateDirectory, release.assetName);
    fs.mkdirSync(updateDirectory, { recursive: true, mode: 0o700 });

    if (fs.existsSync(target) && await sha256File(target) === expectedSha256) {
      downloadedPath = target;
      const total = fs.statSync(target).size;
      onProgress({ percent: 100, transferred: total, total, bytesPerSecond: 0 });
      onLog(`Reusing verified macOS update ${release.assetName}.`);
      return { ...publicRelease(release), assetName: release.assetName };
    }

    const response = await fetchTrusted(release.assetUrl, 'macOS update DMG', fetchImpl, {
      headers: { 'User-Agent': 'Rel.AI-MCP-Updater' }
    });
    if (!response.body?.getReader) throw new Error('The macOS update download did not provide a readable response body.');

    const temporary = `${target}.${process.pid}.part`;
    fs.rmSync(temporary, { force: true });
    const handle = await fs.promises.open(temporary, 'w', 0o600);
    const hash = crypto.createHash('sha256');
    const reader = response.body.getReader();
    const total = positiveInteger(response.headers.get('content-length')) || release.assetSize;
    let transferred = 0;
    const startedAt = now();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        await writeAll(handle, value);
        hash.update(value);
        transferred += value.byteLength;
        const elapsedMs = Math.max(1, now() - startedAt);
        onProgress({
          percent: total > 0 ? (transferred / total) * 100 : 0,
          transferred,
          total,
          bytesPerSecond: Math.round((transferred * 1000) / elapsedMs)
        });
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      await handle.close();
    }

    const actualSha256 = hash.digest('hex');
    if (actualSha256 !== expectedSha256) {
      fs.rmSync(temporary, { force: true });
      throw new Error(`Downloaded macOS update failed SHA-256 verification for ${release.assetName}.`);
    }
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
    downloadedPath = target;
    onProgress({ percent: 100, transferred, total: total || transferred, bytesPerSecond: 0 });
    onLog(`Verified macOS update ${release.assetName}.`);
    return { ...publicRelease(release), assetName: release.assetName };
  }

  async function openDownloaded(version) {
    const requestedVersion = String(version || '').trim();
    if (!release || release.version !== requestedVersion || !downloadedPath || !fs.existsSync(downloadedPath)) {
      throw new Error('The verified macOS update DMG is no longer available. Download it again.');
    }
    const openError = await openPath(downloadedPath);
    if (String(openError || '').trim()) throw new Error(`macOS could not open the update DMG: ${String(openError).trim()}`);
    return { ok: true, assetName: path.basename(downloadedPath) };
  }

  return { checkForUpdates, downloadUpdate, openDownloaded };
}

function parseRelease(payload, arch) {
  if (!payload || typeof payload !== 'object' || payload.draft === true || payload.prerelease === true) {
    throw new Error('GitHub did not return a stable Rel.AI release.');
  }
  const version = stableVersion(payload.tag_name);
  if (!version) throw new Error('GitHub release metadata contains an invalid stable version.');
  const assetName = `Rel.AI-MCP-${version}-mac-${arch}.dmg`;
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const asset = assets.find(candidate => String(candidate?.name || '') === assetName);
  const checksum = assets.find(candidate => String(candidate?.name || '') === CHECKSUM_ASSET_NAME);
  if (!asset?.browser_download_url) throw new Error(`GitHub release ${version} does not contain ${assetName}.`);
  if (!checksum?.browser_download_url) throw new Error(`GitHub release ${version} does not contain ${CHECKSUM_ASSET_NAME}.`);
  assertTrustedDownloadUrl(asset.browser_download_url);
  assertTrustedDownloadUrl(checksum.browser_download_url);
  return {
    version,
    releaseDate: String(payload.published_at || '').trim(),
    releaseNotes: String(payload.body || '').trim(),
    assetName,
    assetUrl: String(asset.browser_download_url),
    assetSize: positiveInteger(asset.size),
    checksumUrl: String(checksum.browser_download_url)
  };
}

function publicRelease(release) {
  return {
    version: release.version,
    releaseDate: release.releaseDate,
    releaseNotes: release.releaseNotes,
    assetName: release.assetName
  };
}

async function fetchTrusted(url, label, fetchImpl, options = {}) {
  assertTrustedUrl(url);
  const response = await fetchImpl(url, { redirect: 'follow', ...options });
  if (!response?.ok) throw new Error(`${label} request failed with HTTP ${response?.status || 'unknown'}.`);
  return response;
}

function assertTrustedUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('Update URLs must use HTTPS.');
  if (url.hostname === 'api.github.com' && url.pathname === '/repos/Kyne0328/rel-ai-mcp/releases/latest') return;
  if (url.hostname === 'github.com' && url.pathname.startsWith(RELEASE_DOWNLOAD_PREFIX)) return;
  throw new Error(`Untrusted update URL: ${url.hostname}${url.pathname}`);
}

function assertTrustedDownloadUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(RELEASE_DOWNLOAD_PREFIX)) {
    throw new Error('GitHub release metadata contains an untrusted download URL.');
  }
}

async function boundedText(response, limit) {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > limit) throw new Error('Release checksum metadata is unexpectedly large.');
  return text;
}

function checksumFor(source, fileName) {
  for (const rawLine of String(source || '').split(/\r?\n/)) {
    const match = rawLine.trim().match(/^([a-fA-F0-9]{64})\s+[* ]?(.+)$/);
    if (!match) continue;
    if (match[2].trim() === fileName) return match[1].toLowerCase();
  }
  return '';
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function writeAll(handle, value) {
  let offset = 0;
  while (offset < value.byteLength) {
    const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset, null);
    if (bytesWritten <= 0) throw new Error('The macOS update download stopped writing before completion.');
    offset += bytesWritten;
  }
}

function positiveInteger(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function stableVersion(value) {
  const version = String(value || '').trim().replace(/^v/i, '');
  return /^\d+\.\d+\.\d+$/.test(version) ? version : '';
}

export { CHECKSUM_ASSET_NAME, RELEASES_API_URL, checksumFor, createMacManualUpdater, parseRelease };
