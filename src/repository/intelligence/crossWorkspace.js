import fs from 'node:fs';
import path from 'node:path';

import { currentGeneration, openIndexDatabase, repositoryIndexPath } from './database.js';
import { repositoryIndexStatus } from './indexer.js';
import { boundedInteger } from './limits.js';

const DEFAULT_MAX_PEERS = 24;
const DEFAULT_MAX_HINTS_PER_WORKSPACE = 1200;
const DEFAULT_MAX_RELATIONSHIPS = 100;
const COMPLEMENT = Object.freeze({
  HTTP_CALLS: 'HANDLES',
  HANDLES: 'HTTP_CALLS',
  EMITS: 'LISTENS_ON',
  LISTENS_ON: 'EMITS'
});

function analyzeCrossWorkspace(workspace, config = {}, localDb, options = {}) {
  const allPeers = configuredPeers(workspace, config);
  const maxPeers = boundedInteger(options.maxPeers, 1, 50, DEFAULT_MAX_PEERS);
  const peers = allPeers.slice(0, maxPeers);
  const maxHints = boundedInteger(options.maxHintsPerWorkspace, 50, 5000, DEFAULT_MAX_HINTS_PER_WORKSPACE);
  const maxRelationships = boundedInteger(options.maxRelationships, 1, 500, DEFAULT_MAX_RELATIONSHIPS);
  const localHints = safeReadRelationshipHints(localDb, maxHints);
  const localPackage = packageDescriptor(workspace.path);
  const localStatus = repositoryIndexStatus(workspace, config);
  const localFreshness = graphFreshness(localStatus);
  const peerSnapshots = [];
  const skipped = [];

  for (const peer of peers) {
    const graph = openPeerGraph(peer, config);
    const packageInfo = packageDescriptor(peer.path);
    if (!graph) {
      peerSnapshots.push({ workspace: peer.alias, path: peer.path, freshness: 'unavailable', generation: null, hints: [], packageInfo });
      skipped.push({ workspace: peer.alias, reason: 'persistent graph unavailable' });
      continue;
    }
    try {
      peerSnapshots.push({
        workspace: peer.alias,
        path: peer.path,
        freshness: graph.freshness,
        generation: Number(graph.generation.id || 0),
        hints: safeReadRelationshipHints(graph.db, maxHints),
        packageInfo
      });
    } finally {
      graph.db.close();
    }
  }

  const relationships = matchGraphRelationships(workspace, localHints, peerSnapshots, maxRelationships, localFreshness);
  const packageRelationships = matchPackageRelationships(workspace, localPackage, peerSnapshots, maxRelationships - relationships.length);
  const combined = [...relationships, ...packageRelationships].slice(0, maxRelationships);
  return {
    strategy: 'separate-cached-workspace-graphs',
    localFreshness,
    configuredPeerCount: allPeers.length,
    consideredPeerCount: peers.length,
    indexedPeerCount: peerSnapshots.filter(peer => peer.generation != null).length,
    relationshipCount: combined.length,
    relationships: combined,
    peers: peerSnapshots.map(peer => ({
      workspace: peer.workspace,
      generation: peer.generation,
      freshness: peer.freshness,
      hintCount: peer.hints.length,
      packageName: peer.packageInfo?.name || null
    })),
    skipped,
    truncated: allPeers.length > peers.length || combined.length >= maxRelationships,
    policy: 'Peer workspaces are read cache-only and never indexed as a side effect of architecture inspection. Ambiguous endpoint/event matches are retained with reduced confidence.'
  };
}

function matchGraphRelationships(workspace, localHints, peers, maxRelationships, localFreshness) {
  if (maxRelationships <= 0) return [];
  const peerIndex = new Map();
  for (const peer of peers) {
    for (const hint of peer.hints) {
      const key = relationshipKey(hint.type, hint.targetName);
      if (!key) continue;
      const indexKey = `${hint.type}\u0000${key}`;
      if (!peerIndex.has(indexKey)) peerIndex.set(indexKey, []);
      peerIndex.get(indexKey).push({ peer, hint });
    }
  }

  const result = [];
  const seen = new Set();
  for (const local of localHints) {
    const complement = COMPLEMENT[local.type];
    const key = relationshipKey(local.type, local.targetName);
    if (!complement || !key) continue;
    const matches = peerIndex.get(`${complement}\u0000${key}`) || [];
    for (const match of matches) {
      const relation = crossRelation(workspace, local, match.peer, match.hint, key, matches.length, localFreshness);
      const dedupeKey = [relation.type, relation.from.workspace, relation.from.path, relation.to.workspace, relation.to.path, key].join('\u0000');
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      result.push(relation);
      if (result.length >= maxRelationships) return result;
    }
  }
  return result;
}

function crossRelation(workspace, local, peer, remote, key, matchCount, localFreshness) {
  const localIsSource = ['HTTP_CALLS', 'EMITS'].includes(local.type);
  const type = local.type === 'HTTP_CALLS'
    ? 'CROSS_HTTP_CALLS'
    : local.type === 'HANDLES'
      ? 'CROSS_HTTP_CALLED_BY'
      : local.type === 'EMITS'
        ? 'CROSS_EMITS_TO'
        : 'CROSS_RECEIVES_FROM';
  const localEndpoint = endpoint(workspace.alias, local);
  const remoteEndpoint = endpoint(peer.workspace, remote);
  const freshnessPenalty = (peer.freshness === 'current' ? 0 : 0.12) + (localFreshness === 'current' ? 0 : 0.12);
  const ambiguous = matchCount > 1;
  return {
    type,
    direction: localIsSource ? 'outgoing' : 'incoming',
    key,
    from: localIsSource ? localEndpoint : remoteEndpoint,
    to: localIsSource ? remoteEndpoint : localEndpoint,
    peerWorkspace: peer.workspace,
    peerGeneration: peer.generation,
    peerFreshness: peer.freshness,
    ambiguous,
    confidence: Number(Math.max(0.5, (ambiguous ? 0.76 : 0.97) - freshnessPenalty).toFixed(2))
  };
}

function endpoint(workspaceAlias, hint) {
  return {
    workspace: workspaceAlias,
    path: hint.path,
    symbol: hint.sourceQualifiedName || hint.sourceName || null
  };
}

function matchPackageRelationships(workspace, localPackage, peers, remaining) {
  if (!localPackage || remaining <= 0) return [];
  const result = [];
  for (const peer of peers) {
    const remote = peer.packageInfo;
    if (!remote?.name) continue;
    if (localPackage.dependencies.has(remote.name)) {
      result.push({
        type: 'CROSS_PACKAGE_DEPENDS_ON', direction: 'outgoing', key: remote.name,
        from: { workspace: workspace.alias, path: 'package.json', symbol: localPackage.name || null },
        to: { workspace: peer.workspace, path: 'package.json', symbol: remote.name },
        peerWorkspace: peer.workspace, peerGeneration: peer.generation, peerFreshness: peer.freshness,
        ambiguous: false, confidence: 0.99
      });
    }
    if (localPackage.name && remote.dependencies.has(localPackage.name)) {
      result.push({
        type: 'CROSS_PACKAGE_USED_BY', direction: 'incoming', key: localPackage.name,
        from: { workspace: peer.workspace, path: 'package.json', symbol: remote.name },
        to: { workspace: workspace.alias, path: 'package.json', symbol: localPackage.name },
        peerWorkspace: peer.workspace, peerGeneration: peer.generation, peerFreshness: peer.freshness,
        ambiguous: false, confidence: 0.99
      });
    }
    if (result.length >= remaining) break;
  }
  return result.slice(0, remaining);
}

function safeReadRelationshipHints(db, limit) {
  try { return readRelationshipHints(db, limit); } catch { return []; }
}

function readRelationshipHints(db, limit) {
  return db.prepare(`
    SELECT rh.type, rh.target_name, rh.source_qualified_name, rh.source_name, f.path
    FROM relation_hints rh JOIN files f ON f.id=rh.source_file_id
    WHERE rh.type IN ('HTTP_CALLS','HANDLES','EMITS','LISTENS_ON')
    ORDER BY rh.id LIMIT ?
  `).all(limit).map(row => ({
    type: String(row.type),
    targetName: row.target_name == null ? '' : String(row.target_name),
    sourceQualifiedName: row.source_qualified_name == null ? null : String(row.source_qualified_name),
    sourceName: row.source_name == null ? null : String(row.source_name),
    path: String(row.path)
  }));
}

function openPeerGraph(peer, config) {
  if (!peer.path || !fs.existsSync(peer.path)) return null;
  let databaseFile;
  try { databaseFile = repositoryIndexPath(config, peer); } catch { return null; }
  if (!fs.existsSync(databaseFile)) return null;
  let db;
  try {
    db = openIndexDatabase(databaseFile, { readonly: true });
    const generation = currentGeneration(db);
    if (!generation) { db.close(); return null; }
    const status = repositoryIndexStatus(peer, config);
    return { db, generation, freshness: graphFreshness(status) };
  } catch {
    try { db?.close(); } catch {}
    return null;
  }
}

function configuredPeers(workspace, config) {
  const currentPath = normalizeFsPath(workspace.path);
  const peers = [];
  for (const [alias, entry] of Object.entries(config.workspaces || {})) {
    if (alias === workspace.alias || !entry?.path) continue;
    const peerPath = normalizeFsPath(entry.path);
    if (!peerPath || peerPath === currentPath) continue;
    peers.push({ alias, path: entry.path, context: entry.context || {} });
  }
  return peers.sort((left, right) => left.alias.localeCompare(right.alias));
}

function packageDescriptor(root) {
  try {
    const file = path.join(root, 'package.json');
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) return null;
    const parsed = JSON.parse(raw);
    const dependencyMaps = [parsed.dependencies, parsed.devDependencies, parsed.peerDependencies, parsed.optionalDependencies];
    const dependencies = new Set(dependencyMaps.flatMap(map => map && typeof map === 'object' ? Object.keys(map) : []));
    return { name: String(parsed.name || '').trim() || null, dependencies };
  } catch {
    return null;
  }
}

function relationshipKey(type, targetName) {
  const value = String(targetName || '').trim();
  if (!value) return '';
  if (type === 'HTTP_CALLS' || type === 'HANDLES') return canonicalHttpKey(value);
  if (type === 'EMITS' || type === 'LISTENS_ON') return value.startsWith('event:') ? value : `event:${value}`;
  return value;
}

function canonicalHttpKey(value) {
  const match = String(value || '').match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
  if (!match) return '';
  let target = match[2].trim();
  try {
    if (/^https?:\/\//i.test(target)) target = new URL(target).pathname;
  } catch { return ''; }
  target = target.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/');
  if (!target.startsWith('/')) return '';
  if (target.length > 1) target = target.replace(/\/$/, '');
  return `${match[1].toUpperCase()} ${target}`;
}

function normalizeFsPath(value) {
  let normalized = path.resolve(String(value || '')).replaceAll('\\', '/').replace(/\/$/, '');
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return normalized;
}

function graphFreshness(status = {}) {
  if (status.metadata) return status.dirty ? 'stale' : 'current';
  return 'cached-unverified';
}

export { analyzeCrossWorkspace };
