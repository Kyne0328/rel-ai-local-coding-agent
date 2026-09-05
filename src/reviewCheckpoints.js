import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readJsonFile, writeJsonAtomic } from './durableState.js';
import { getStateDir } from './statePaths.js';

const REVIEW_SCHEMA_VERSION = 1;
const CHECKPOINT_ID_PATTERN = /^review_[A-Za-z0-9_-]{24,160}$/;

function createReviewCheckpoint(workspace, config, review) {
  if (!review || review.ok !== true) throw new Error('Cannot checkpoint an unsuccessful review.');
  const directory = checkpointDirectory(workspace, config);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const createdAt = new Date().toISOString();
  const payload = clone(review);
  const payloadSha256 = digest(payload);
  let checkpointId;
  let target;
  do {
    checkpointId = `review_${crypto.randomBytes(24).toString('base64url')}`;
    target = path.join(directory, `${checkpointId}.json`);
  } while (fs.existsSync(target));
  const record = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    checkpointId,
    workspaceKey: workspaceKey(workspace),
    workspace: workspace.alias,
    createdAt,
    payloadSha256,
    payload
  };
  writeJsonAtomic(target, record, { mode: 0o600 });
  return { ...payload, checkpointId, payloadSha256, createdAt, replayed: false };
}

function replayReviewCheckpoint(workspace, config, checkpointId) {
  const id = validateCheckpointId(checkpointId);
  const target = path.join(checkpointDirectory(workspace, config), `${id}.json`);
  const record = readJsonFile(target, { validate: isReviewRecord });
  if (!record) throw new Error(`Unknown review checkpoint: ${id}`);
  if (record.workspaceKey !== workspaceKey(workspace)) {
    throw new Error(`Review checkpoint ${id} belongs to a different workspace.`);
  }
  const actualSha256 = digest(record.payload);
  if (!safeEqual(actualSha256, record.payloadSha256)) {
    throw new Error(`Review checkpoint ${id} failed its integrity check.`);
  }
  return {
    ...clone(record.payload),
    checkpointId: id,
    payloadSha256: record.payloadSha256,
    createdAt: record.createdAt,
    replayed: true
  };
}

function checkpointDirectory(workspace, config) {
  return path.join(getStateDir(config), 'review-checkpoints', workspaceKey(workspace));
}

function workspaceKey(workspace) {
  let root = path.resolve(String(workspace?.path || ''));
  try { root = fs.realpathSync(root); } catch {}
  const normalized = process.platform === 'win32' ? root.toLowerCase() : root;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

function validateCheckpointId(value) {
  const id = String(value || '').trim();
  if (!CHECKPOINT_ID_PATTERN.test(id)) throw new Error('Invalid review checkpointId.');
  return id;
}

function isReviewRecord(value) {
  return Boolean(value
    && value.schemaVersion === REVIEW_SCHEMA_VERSION
    && CHECKPOINT_ID_PATTERN.test(String(value.checkpointId || ''))
    && /^[a-f0-9]{32}$/.test(String(value.workspaceKey || ''))
    && /^[a-f0-9]{64}$/.test(String(value.payloadSha256 || ''))
    && typeof value.createdAt === 'string'
    && value.payload
    && typeof value.payload === 'object');
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export { createReviewCheckpoint, replayReviewCheckpoint };
