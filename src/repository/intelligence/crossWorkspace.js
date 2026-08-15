import fs from 'node:fs';
import path from 'node:path';

import { currentGeneration, openIndexDatabase, repositoryIndexPath } from './database.js';
import { repositoryIndexStatus } from './indexer.js';
import { boundedInteger } from './limits.js';
import { recordIntelligenceDiagnostic, repositoryFreshness } from './state.js';

const DEFAULT_MAX_PEERS = 24;
const DEFAULT_MAX_HINTS_PER_WORKSPACE = 1200;
const DEFAULT_MAX_RELATIONSHIPS = 100;
const COMPLEMENT = Object.freeze({
  HTTP_CALLS: 'HANDLES',
  HANDLES: 'HTTP_CALLS',
  EMITS: 'LISTENS_ON',
  LISTENS_ON: 'EMITS'
});
const GENERIC_PLATFORM_EVENTS = new Set([
  'abort', 'aborted', 'beforeunload', 'blur', 'change', 'click', 'close', 'connect',
  'connection', 'data', 'DOMContentLoaded', 'drain', 'end', 'error', 'finish', 'focus',
  'hashchange', 'input', 'keydown', 'keypress', 'keyup', 'load', 'message', 'mousedown',
  'mouseenter', 'mouseleave', 'mousemove', 'mouseout', 'mouseover', 'mouseup', 'offline',
  'online', 'open', 'pointerdown', 'pointermove', 'pointerup', 'popstate', 'ready', 'request',
  'resize', 'response', 'scroll', 'storage', 'submit', 'timeout', 'touchend', 'touchmove',
  'touchstart', 'unload', 'visibilitychange'
].map(value => value.toLowerCase()));

function analyzeCrossWorkspace(workspace, config = {}, localDb, options = {}) {
  const configured = configuredPeers(workspace, config);
  const maxPeers = boundedInteger(options.maxPeers, 1, 50, DEFAULT_MAX_PEERS);
  const maxHints = boundedInteger(options.maxHintsPerWorkspace, 50, 5000, DEFAULT_MAX_HINTS_PER_WORKSPACE);
  const maxRelationships = boundedInteger(options.maxRelationships, 1, 500, DEFAULT_MAX_RELATIONSHIPS);
  const localHints = safeReadRelationshipHints(localDb, maxHints, workspace);
  const localPackage = packageDescriptor(workspace.path);
  const repositoryStatuses = options.repositoryStatuses || {};
  const allPeers = rankConfiguredPeers(configured, localPackage, repositoryStatuses);
  const peers = allPeers.slice(0, maxPeers);
  const localStatus = repositoryStatuses[workspace.alias] || repositoryIndexStatus(workspace, config);
  const localGeneration = currentGeneration(localDb);
  const localFreshness = repositoryFreshness(localStatus, localGeneration);
  const peerSnapshots = [];
  const skipped = [];

  for (const peer of peers) {
    const graph = openPeerGraph(peer, config, repositoryStatuses[peer.alias]);
    const packageInfo = peer.packageInfo || packageDescriptor(peer.path);
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
        hints: safeReadRelationshipHints(graph.db, maxHints, peer),
        packageInfo
      });
    } finally {
      graph.db.close();
    }
  }

  const graphPeers = peerSnapshots.filter(peer => peerHasStrongRelationshipEvidence(localPackage, localHints, peer));
  const relationships = matchGraphRelationships(workspace, localHints, graphPeers, maxRelationships, localFreshness);
  const packageRelationships = matchPackageRelationships(workspace, localPackage, peerSnapshots, maxRelationships - relationships.length);
  const combined = [...relationships, ...packageRelationships].slice(0, maxRelationships);
  return {
    strategy: 'separate-cached-workspace-graphs',
    localFreshness,
    configuredPeerCount: allPeers.length,
    consideredPeerCount: peers.length,
    indexedPeerCount: peerSnapshots.filter(peer => peer.generation != null).length,
    graphEligiblePeerCount: graphPeers.length,
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
    policy: 'Peer workspaces are read cache-only. Graph matching requires complementary cross-boundary evidence; generic platform/browser events are ignored, and confidence reflects evidence quality, ambiguity, and freshness.'
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
  const freshnessPenalty = (peer.freshness === 'current' ? 0 : 0.08) + (localFreshness === 'current' ? 0 : 0.08);
  const ambiguous = matchCount > 1;
  const evidenceConfidence = Math.min(normalizedHintConfidence(local), normalizedHintConfidence(remote));
  const evidenceBase = key.startsWith('event:') ? 0.9 : 0.97;
  const ambiguityPenalty = ambiguous ? 0.14 : 0;
  const confidence = Math.max(0.5, evidenceBase * (0.85 + evidenceConfidence * 0.15) - ambiguityPenalty - freshnessPenalty);
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
    evidence: key.startsWith('event:') ? 'custom-event-contract' : 'http-contract',
    confidence: Number(confidence.toFixed(2))
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
      const dependencyKind = localPackage.dependencyKinds.get(remote.name) || 'dependencies';
      result.push({
        type: 'CROSS_PACKAGE_DEPENDS_ON', direction: 'outgoing', key: remote.name,
        from: { workspace: workspace.alias, path: 'package.json', symbol: localPackage.name || null },
        to: { workspace: peer.workspace, path: 'package.json', symbol: remote.name },
        peerWorkspace: peer.workspace, peerGeneration: peer.generation, peerFreshness: peer.freshness,
        dependencyKind, ambiguous: false, confidence: packageDependencyConfidence(dependencyKind)
      });
    }
    if (localPackage.name && remote.dependencies.has(localPackage.name)) {
      const dependencyKind = remote.dependencyKinds.get(localPackage.name) || 'dependencies';
      result.push({
        type: 'CROSS_PACKAGE_USED_BY', direction: 'incoming', key: localPackage.name,
        from: { workspace: peer.workspace, path: 'package.json', symbol: remote.name },
        to: { workspace: workspace.alias, path: 'package.json', symbol: localPackage.name },
        peerWorkspace: peer.workspace, peerGeneration: peer.generation, peerFreshness: peer.freshness,
        dependencyKind, ambiguous: false, confidence: packageDependencyConfidence(dependencyKind)
      });
    }
    if (result.length >= remaining) break;
  }
  return result.slice(0, remaining);
}

function safeReadRelationshipHints(db, limit, workspace = null) {
  try { return readRelationshipHints(db, limit); } catch (error) {
    recordIntelligenceDiagnostic(workspace, 'cross_workspace_hints_failed', error);
    return [];
  }
}

function readRelationshipHints(db, limit) {
  return db.prepare(`
    SELECT rh.type, rh.target_name, rh.source_qualified_name, rh.source_name, rh.provider, rh.confidence, f.path
    FROM relation_hints rh JOIN files f ON f.id=rh.source_file_id
    WHERE rh.type IN ('HTTP_CALLS','HANDLES','EMITS','LISTENS_ON')
    ORDER BY rh.id LIMIT ?
  `).all(limit).map(row => ({
    type: String(row.type),
    targetName: row.target_name == null ? '' : String(row.target_name),
    sourceQualifiedName: row.source_qualified_name == null ? null : String(row.source_qualified_name),
    sourceName: row.source_name == null ? null : String(row.source_name),
    provider: row.provider == null ? '' : String(row.provider),
    confidence: Number(row.confidence || 0),
    path: String(row.path)
  }));
}

function openPeerGraph(peer, config, statusOverride = null) {
  if (!peer.path || !fs.existsSync(peer.path)) return null;
  let databaseFile;
  try { databaseFile = repositoryIndexPath(config, peer); } catch (error) {
    recordIntelligenceDiagnostic(peer, 'cross_workspace_peer_path_failed', error);
    return null;
  }
  if (!fs.existsSync(databaseFile)) return null;
  let db;
  try {
    db = openIndexDatabase(databaseFile, { readonly: true });
    const generation = currentGeneration(db);
    if (!generation) { db.close(); return null; }
    const status = statusOverride || repositoryIndexStatus(peer, config);
    return { db, generation, freshness: repositoryFreshness(status, generation) };
  } catch (error) {
    try { db?.close(); } catch {}
    recordIntelligenceDiagnostic(peer, 'cross_workspace_peer_open_failed', error);
    return null;
  }
}

function configuredPeers(workspace, config) {
  const currentPath = normalizeFsPath(workspace.path);
  const sourceAlias = workspace?.taskSandbox === true ? String(workspace.sourceAlias || '').trim() : '';
  const peers = [];
  for (const [alias, entry] of Object.entries(config.workspaces || {})) {
    if (alias === workspace.alias || alias === sourceAlias || !entry?.path) continue;
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
    const dependencyKinds = new Map();
    for (const kind of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
      const values = parsed[kind];
      if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
      for (const name of Object.keys(values)) if (!dependencyKinds.has(name)) dependencyKinds.set(name, kind);
    }
    return { name: String(parsed.name || '').trim() || null, dependencies: new Set(dependencyKinds.keys()), dependencyKinds };
  } catch {
    return null;
  }
}

function rankConfiguredPeers(peers, localPackage, repositoryStatuses = {}) {
  return peers.map(peer => {
    const packageInfo = packageDescriptor(peer.path);
    let score = 0;
    if (localPackage && packageInfo?.name && localPackage.dependencies.has(packageInfo.name)) {
      score += packageDependencyRank(localPackage.dependencyKinds.get(packageInfo.name));
    }
    if (localPackage?.name && packageInfo?.dependencies.has(localPackage.name)) {
      score += Math.round(packageDependencyRank(packageInfo.dependencyKinds.get(localPackage.name)) * 0.9);
    }
    const status = repositoryStatuses[peer.alias];
    if (status?.metadata) score += 12;
    if (status?.dirty === false) score += 4;
    return { ...peer, packageInfo, rankScore: score };
  }).sort((left, right) => right.rankScore - left.rankScore || left.alias.localeCompare(right.alias));
}

function packageDependencyRank(kind) {
  if (kind === 'dependencies') return 100;
  if (kind === 'peerDependencies') return 80;
  if (kind === 'optionalDependencies') return 60;
  if (kind === 'devDependencies') return 30;
  return 20;
}

function packageDependencyConfidence(kind) {
  if (kind === 'dependencies') return 0.99;
  if (kind === 'peerDependencies') return 0.94;
  if (kind === 'optionalDependencies') return 0.88;
  if (kind === 'devDependencies') return 0.72;
  return 0.7;
}

function relationshipKey(type, targetName) {
  const value = String(targetName || '').trim();
  if (!value) return '';
  if (type === 'HTTP_CALLS' || type === 'HANDLES') return canonicalHttpKey(value);
  if (type === 'EMITS' || type === 'LISTENS_ON') {
    const eventName = value.replace(/^event:/i, '').trim();
    if (!eventName || GENERIC_PLATFORM_EVENTS.has(eventName.toLowerCase())) return '';
    return `event:${eventName}`;
  }
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

function peerHasStrongRelationshipEvidence(localPackage, localHints, peer) {
  const remotePackage = peer?.packageInfo;
  if (localPackage && remotePackage?.name) {
    if (localPackage.dependencies.has(remotePackage.name)) return true;
    if (localPackage.name && remotePackage.dependencies.has(localPackage.name)) return true;
  }
  const remoteKeys = new Set((peer?.hints || []).map(hint => {
    const key = relationshipKey(hint.type, hint.targetName);
    return key ? `${hint.type}\u0000${key}` : '';
  }).filter(Boolean));
  return (localHints || []).some(hint => {
    const complement = COMPLEMENT[hint.type];
    const key = relationshipKey(hint.type, hint.targetName);
    return Boolean(complement && key && remoteKeys.has(`${complement}\u0000${key}`));
  });
}

function normalizedHintConfidence(hint) {
  const value = Number(hint?.confidence);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.8;
}

function normalizeFsPath(value) {
  let normalized = path.resolve(String(value || '')).replaceAll('\\', '/').replace(/\/$/, '');
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return normalized;
}

export { analyzeCrossWorkspace, configuredPeers, peerHasStrongRelationshipEvidence, relationshipKey };
