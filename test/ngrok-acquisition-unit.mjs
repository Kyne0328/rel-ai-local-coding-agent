import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateNgrokManifest,
  verifyFileRecord,
  verifyNgrokExecutable
} from '../electron/ngrok-provenance.js';
import { installVerifiedBinary } from '../electron/managed-ngrok.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const executableBytes = Buffer.from('verified-ngrok-executable');
const archiveBytes = Buffer.from('verified-ngrok-archive');
const manifest = {
  schemaVersion: 2,
  version: '3.39.10',
  delivery: 'verified-first-run-download',
  platforms: {
    win32: {
      architecture: 'x64',
      archive: {
        format: 'zip',
        url: 'https://bin.ngrok.com/a/reviewed/ngrok.zip',
        size: archiveBytes.length,
        sha256: hash(archiveBytes)
      },
      executable: {
        file: 'ngrok.exe',
        size: executableBytes.length,
        sha256: hash(executableBytes)
      },
      authenticode: {
        publisher: 'ngrok, Inc.',
        issuer: 'DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1'
      }
    }
  }
};

assert.doesNotThrow(() => validateNgrokManifest(structuredClone(manifest)));

const insecure = structuredClone(manifest);
insecure.platforms.win32.archive.url = 'http://bin.ngrok.com/ngrok.zip';
assert.throws(() => validateNgrokManifest(insecure), /approved ngrok HTTPS distribution host/);

const untrusted = structuredClone(manifest);
untrusted.platforms.win32.archive.url = 'https://example.invalid/ngrok.zip';
assert.throws(() => validateNgrokManifest(untrusted), /approved ngrok HTTPS distribution host/);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-ngrok-unit-'));
try {
  const archivePath = path.join(temporaryRoot, 'ngrok.zip');
  const executablePath = path.join(temporaryRoot, 'ngrok.exe');
  fs.writeFileSync(archivePath, archiveBytes);
  fs.writeFileSync(executablePath, executableBytes);

  assert.equal(verifyFileRecord(archivePath, manifest.platforms.win32.archive, 'archive').sha256, hash(archiveBytes));
  fs.appendFileSync(archivePath, 'tampered');
  assert.throws(() => verifyFileRecord(archivePath, manifest.platforms.win32.archive, 'archive'), /size mismatch/);

  const validSignature = {
    status: 'Valid',
    subject: 'CN=ngrok, Inc.',
    issuer: 'CN=DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1'
  };
  const validVerification = verifyNgrokExecutable(executablePath, manifest, manifest.platforms.win32, {
    platform: 'win32',
    inspectSignature: () => validSignature,
    readVersion: () => 'ngrok version 3.39.10'
  });
  assert.equal(validVerification.version, '3.39.10');

  assert.throws(() => verifyNgrokExecutable(executablePath, manifest, manifest.platforms.win32, {
    platform: 'win32',
    inspectSignature: () => ({ ...validSignature, subject: 'CN=Unexpected Publisher' }),
    readVersion: () => 'ngrok version 3.39.10'
  }), /publisher mismatch/);

  assert.throws(() => verifyNgrokExecutable(executablePath, manifest, manifest.platforms.win32, {
    platform: 'win32',
    inspectSignature: () => ({ ...validSignature, issuer: 'CN=Unexpected Issuer' }),
    readVersion: () => 'ngrok version 3.39.10'
  }), /certificate issuer mismatch/);

  assert.throws(() => verifyNgrokExecutable(executablePath, manifest, manifest.platforms.win32, {
    platform: 'win32',
    inspectSignature: () => validSignature,
    readVersion: () => 'ngrok version 3.39.11'
  }), /version mismatch/);

  const source = path.join(temporaryRoot, 'source.exe');
  const target = path.join(temporaryRoot, 'managed', 'ngrok.exe');
  fs.writeFileSync(source, 'replacement');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'known-good-existing');
  assert.throws(() => installVerifiedBinary(source, target, file => {
    assert.equal(fs.readFileSync(file, 'utf8'), 'replacement');
    if (file === target) throw new Error('final verification failed');
    return { ok: true };
  }), /final verification failed/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'known-good-existing', 'failed promotion must restore the previous managed agent');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('ngrok acquisition unit tests passed.');
