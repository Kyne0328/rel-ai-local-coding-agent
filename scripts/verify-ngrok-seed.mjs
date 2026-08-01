import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ngrokSpecForCurrentPlatform,
  readNgrokManifest,
  verifyNgrokArchive,
  verifyNgrokExecutable
} from '../electron/ngrok-provenance.js';
import {
  downloadNgrokArchive,
  extractNgrokArchive,
  findExtractedExecutable
} from '../electron/managed-ngrok.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'vendor', 'ngrok', 'manifest.json');
const verifyDownload = process.argv.includes('--download');

async function main() {
  const { manifest } = readNgrokManifest({ manifestPath });
  const spec = ngrokSpecForCurrentPlatform(manifest, {
    platform: process.env.REL_AI_TARGET_PLATFORM || process.platform,
    architecture: process.env.REL_AI_TARGET_ARCH || process.arch
  });

  console.log(`[verify-ngrok] Manifest OK: ngrok ${manifest.version}, archive sha256=${spec.archive.sha256}, executable sha256=${spec.executable.sha256}.`);
  if (!verifyDownload) {
    console.log('[verify-ngrok] Runtime acquisition was not requested; no ngrok executable is stored in the repository or application package.');
    return;
  }
  if (process.platform !== 'win32') throw new Error('End-to-end ngrok acquisition verification requires a Windows host.');

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-ai-ngrok-release-check-'));
  const archivePath = path.join(temporaryRoot, 'ngrok.zip');
  const extractionPath = path.join(temporaryRoot, 'extract');
  try {
    await downloadNgrokArchive(spec.archive.url, archivePath, {
      expectedSize: spec.archive.size,
      maxBytes: spec.archive.size,
      onLog: message => console.log(`[verify-ngrok] ${message}`)
    });
    const archive = verifyNgrokArchive(archivePath, spec);
    extractNgrokArchive(archivePath, extractionPath);
    const executablePath = findExtractedExecutable(extractionPath, spec.executable.file);
    const executable = verifyNgrokExecutable(executablePath, manifest, spec);
    console.log(`[verify-ngrok] Acquisition OK: archive ${archive.bytes} bytes; executable ${executable.bytes} bytes; Authenticode and version valid.`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(`[verify-ngrok] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
