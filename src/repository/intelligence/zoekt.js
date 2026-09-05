import fs from 'node:fs';
import path from 'node:path';

import { runProcess } from '../../process.js';
import { isTestPath } from './languages.js';

const COMMAND_TIMEOUT_MS = 10000;
const INDEX_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
function zoektPaths(databaseFile) {
  const root = path.dirname(databaseFile);
  return {
    root,
    indexDir: path.join(root, 'zoekt'),
    metaFile: path.join(root, 'zoekt-meta.json')
  };
}

function zoektExecutables(settings = {}) {
  const search = settings.zoektSearchExecutable || process.env.REL_AI_ZOEKT_SEARCH || packagedBinary('zoekt');
  const index = settings.zoektIndexExecutable || process.env.REL_AI_ZOEKT_INDEX || packagedBinary('zoekt-index');
  return { search, index };
}

function packagedBinary(name) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const fileName = `${name}${suffix}`;
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const candidates = [
    resourcesPath ? path.join(resourcesPath, 'bin', 'zoekt', process.platform, fileName) : '',
    path.resolve('vendor', 'zoekt', process.platform, fileName),
    path.resolve('bin', fileName)
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0] || fileName;
}

async function rebuildZoektIndex(workspace, databaseFile, settings, graphIndex, candidates, options = {}) {
  const binaries = zoektExecutables(settings);
  const paths = zoektPaths(databaseFile);
  const meta = readJson(paths.metaFile);
  if (meta?.fingerprint === graphIndex.fingerprint && fs.existsSync(paths.indexDir)) {
    return { available: true, current: true, indexDir: paths.indexDir, fingerprint: meta.fingerprint };
  }
  if (!Array.isArray(candidates)) {
    return { available: false, current: false, reason: 'Zoekt index rebuild requires a full repository scan.' };
  }

  const stagingSource = path.join(paths.root, `.zoekt-source-${process.pid}-${Date.now()}`);
  const stagingIndex = path.join(paths.root, `.zoekt-index-${process.pid}-${Date.now()}`);
  fs.mkdirSync(stagingSource, { recursive: true });
  fs.mkdirSync(stagingIndex, { recursive: true });
  try {
    for (const candidate of candidates) stageCandidate(candidate, stagingSource);
    const result = await runProcess(binaries.index, ['-disable_ctags', '-parallelism', '2', '-index', stagingIndex, stagingSource], {
      timeout: INDEX_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      signal: options.signal
    });
    if (result.spawnError || result.timedOut || result.exitCode !== 0) {
      return {
        available: !result.spawnError,
        current: false,
        reason: processFailureReason(result, 'zoekt-index')
      };
    }
    promoteDirectory(stagingIndex, paths.indexDir);
    writeJsonAtomic(paths.metaFile, { fingerprint: graphIndex.fingerprint, indexedAt: new Date().toISOString(), fileCount: candidates.length });
    return { available: true, current: true, indexDir: paths.indexDir, fingerprint: graphIndex.fingerprint };
  } finally {
    try { fs.rmSync(stagingSource, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(stagingIndex, { recursive: true, force: true }); } catch {}
  }
}

async function searchZoekt(workspace, databaseFile, settings, graphIndex, query, maxResults = 100, options = {}) {
  const state = currentZoektIndex(databaseFile, graphIndex);
  if (!state.current) return { ...state, results: [] };
  const { search } = zoektExecutables(settings);
  const result = await runProcess(search, ['-index_dir', state.indexDir, '-jsonl', String(query)], {
    timeout: COMMAND_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    signal: options.signal
  });
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    return {
      available: false,
      current: state.current,
      reason: processFailureReason(result, 'zoekt'),
      results: []
    };
  }
  const results = [];
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const relativePath = normalizeZoektPath(item.FileName || item.fileName || item.filename || '');
    if (!relativePath) continue;
    results.push({
      path: relativePath,
      language: String(item.Language || item.language || ''),
      test: isTestPath(relativePath),
      provider: 'zoekt',
      reasons: ['zoekt-code-search']
    });
    if (results.length >= maxResults) break;
  }
  return { available: true, current: true, results };
}

function currentZoektIndex(databaseFile, graphIndex) {
  const paths = zoektPaths(databaseFile);
  const meta = readJson(paths.metaFile);
  if (meta?.fingerprint !== graphIndex?.fingerprint || !fs.existsSync(paths.indexDir)) {
    return { available: true, current: false, reason: 'Zoekt index is not current; using the lexical fallback until the background Zoekt refresh completes.' };
  }
  return { available: true, current: true, indexDir: paths.indexDir, fingerprint: meta.fingerprint };
}

function processFailureReason(result, label) {
  return String(result?.error || result?.stderr || `${label} exited ${result?.exitCode ?? -1}`).trim().slice(0, 1000);
}

function stageCandidate(candidate, stagingRoot) {
  const target = path.join(stagingRoot, ...candidate.path.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(candidate.absolutePath, target);
}

function promoteDirectory(staging, active) {
  const backup = `${active}.previous-${process.pid}-${Date.now()}`;
  let moved = false;
  try {
    if (fs.existsSync(active)) {
      fs.renameSync(active, backup);
      moved = true;
    }
    fs.renameSync(staging, active);
    if (moved) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(active) && moved && fs.existsSync(backup)) {
      try { fs.renameSync(backup, active); } catch {}
    }
    throw error;
  }
}

function normalizeZoektPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^.*?\.zoekt-source-[^/]+\//, '');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

export { rebuildZoektIndex, searchZoekt };