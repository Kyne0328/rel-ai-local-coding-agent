import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getStateDir } from '../statePaths.js';
import { requestStateKey } from './context.js';
import { stableJson } from './toolManifest.js';

function resolveConnectionGenerations(config, options = {}) {
  const file = options.file || path.join(getStateDir(config), 'connection-generations.json');
  const key = options.key || requestStateKey(config);
  const credentialFingerprint = fingerprint(key, `credential\0${String(options.token || '')}`);
  const configurationFingerprint = fingerprint(key, `configuration\0${stableJson({
    host: String(options.host || ''),
    port: Number(options.port || 0),
    publicUrl: String(options.publicUrl || '')
  })}`);
  const previous = readState(file);
  const next = {
    version: 1,
    credentialGeneration: nextGeneration(previous.credentialGeneration, previous.credentialFingerprint, credentialFingerprint),
    configurationGeneration: nextGeneration(previous.configurationGeneration, previous.configurationFingerprint, configurationFingerprint),
    credentialFingerprint,
    configurationFingerprint,
    updatedAt: new Date().toISOString()
  };
  if (!sameState(previous, next)) writeState(file, next);
  return {
    credentialGeneration: next.credentialGeneration,
    configurationGeneration: next.configurationGeneration
  };
}

function nextGeneration(value, previousFingerprint, currentFingerprint) {
  const generation = Math.max(0, Number(value || 0));
  if (!previousFingerprint) return Math.max(1, generation);
  return previousFingerprint === currentFingerprint ? Math.max(1, generation) : generation + 1;
}

function fingerprint(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}

function readState(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeState(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function sameState(previous, next) {
  return Number(previous.credentialGeneration || 0) === next.credentialGeneration
    && Number(previous.configurationGeneration || 0) === next.configurationGeneration
    && previous.credentialFingerprint === next.credentialFingerprint
    && previous.configurationFingerprint === next.configurationFingerprint;
}

export { resolveConnectionGenerations, fingerprint, nextGeneration };
