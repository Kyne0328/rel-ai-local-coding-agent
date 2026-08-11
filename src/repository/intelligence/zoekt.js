import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { isTestPath } from './languages.js';
import { repositoryIndexPath } from './database.js';
import { scanWorkspace } from './indexBuild.js';

const COMMAND_TIMEOUT_MS = 10000;
const INDEX_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const availabilityCache = new Map();

function zoektPaths(config, workspace) {
  const root = path.dirname(repositoryIndexPath(config, workspace));
  return {
    root,
    indexDir: path.join(root, 'zoekt'),
    metaFile: path.join(root, 'zoekt-meta.json')
  };
}

function zoektExecutables(config = {}) {
  const settings = config.repositoryIntelligence || {};
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

function executableAvailable(executable) {
  const key = String(executable || '');
  if (!key) return false;
  if (availabilityCache.has(key)) return availabilityCache.get(key);
  if ((key.includes('/') || key.includes('\\')) && !fs.existsSync(key)) {
    availabilityCache.set(key, false);
    return false;
  }
  const result = spawnSync(key, ['-h'], { encoding: 'utf8', timeout: 2000, windowsHide: true });
  const available = !result.error && result.status === 0;
  availabilityCache.set(key, available);
  return available;
}

function zoektAvailable(config = {}) {
  const binaries = zoektExecutables(config);
  return executableAvailable(binaries.search) && executableAvailable(binaries.index);
}

function ensureZoektIndex(workspace, config, graphIndex) {
  const binaries = zoektExecutables(config);
  if (!executableAvailable(binaries.search) || !executableAvailable(binaries.index)) {
    return { available: false, current: false, reason: 'Zoekt binaries are not installed or packaged.' };
  }
  const paths = zoektPaths(config, workspace);
  const meta = readJson(paths.metaFile);
  if (meta?.fingerprint === graphIndex.fingerprint && fs.existsSync(paths.indexDir)) {
    return { available: true, current: true, indexDir: paths.indexDir, fingerprint: meta.fingerprint };
  }

  const scan = scanWorkspace(workspace, graphIndex.discoveredFileCount || undefined);
  const stagingSource = path.join(paths.root, `.zoekt-source-${process.pid}-${Date.now()}`);
  const stagingIndex = path.join(paths.root, `.zoekt-index-${process.pid}-${Date.now()}`);
  fs.mkdirSync(stagingSource, { recursive: true });
  fs.mkdirSync(stagingIndex, { recursive: true });
  try {
    for (const candidate of scan.candidates) stageCandidate(candidate, stagingSource);
    const result = spawnSync(binaries.index, ['-disable_ctags', '-parallelism', '2', '-index', stagingIndex, stagingSource], {
      encoding: 'utf8', timeout: INDEX_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true
    });
    if (result.error || result.status !== 0) {
      return {
        available: true,
        current: false,
        reason: String(result.error?.message || result.stderr || `zoekt-index exited ${result.status}`).trim().slice(0, 1000)
      };
    }
    promoteDirectory(stagingIndex, paths.indexDir);
    writeJsonAtomic(paths.metaFile, { fingerprint: graphIndex.fingerprint, indexedAt: new Date().toISOString(), fileCount: scan.candidates.length });
    return { available: true, current: true, indexDir: paths.indexDir, fingerprint: graphIndex.fingerprint };
  } finally {
    try { fs.rmSync(stagingSource, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(stagingIndex, { recursive: true, force: true }); } catch {}
  }
}

function searchZoekt(workspace, config, graphIndex, query, maxResults = 100) {
  const state = ensureZoektIndex(workspace, config, graphIndex);
  if (!state.available || !state.current) return { ...state, results: [] };
  const { search } = zoektExecutables(config);
  const result = spawnSync(search, ['-index_dir', state.indexDir, '-jsonl', String(query)], {
    encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true
  });
  if (result.error || result.status !== 0) {
    return {
      available: true,
      current: true,
      reason: String(result.error?.message || result.stderr || `zoekt exited ${result.status}`).trim().slice(0, 1000),
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

function stageCandidate(candidate, stagingRoot) {
  const target = path.join(stagingRoot, ...candidate.path.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.linkSync(candidate.absolutePath, target);
  } catch {
    fs.copyFileSync(candidate.absolutePath, target);
  }
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

export { ensureZoektIndex, searchZoekt, zoektAvailable };