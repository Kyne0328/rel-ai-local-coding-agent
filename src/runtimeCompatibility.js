'use strict';

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { packageMetadata as pkg } from './packageMetadata.js';
import { getVersion } from './version.js';
import { getToolSurfaceManifest } from './tools/schema.js';
import { allWorkspaceAliases, resolveWorkspace } from './config.js';

const PROTOCOL_VERSION = '2026-07-28';
const SAFE_DURING_RUNTIME_MISMATCH = new Set([
  'relai_status',
  'relai_cancel_task',
  'relai_complete_task',
  'relai_operation_task_get',
  'relai_operation_task_cancel',
  'relai_process_read',
  'relai_process_list',
  'relai_process_stop'
]);

function runtimeMetadata() {
  const surface = getToolSurfaceManifest();
  return normalizeMetadata({
    source: 'runtime',
    applicationVersion: getVersion(),
    packageVersion: pkg.version,
    protocolVersion: PROTOCOL_VERSION,
    toolSurfaceVersion: surface.toolSurfaceVersion,
    toolCount: surface.toolCount,
    manifestHash: toolManifestHash(surface),
    schemaVersion: surface.schemaVersion
  });
}

function repositoryMetadata(config, preferredWorkspace = '') {
  const candidates = repositoryCandidates(config, preferredWorkspace);
  for (const candidate of candidates) {
    const metadata = readRepositoryMetadata(candidate.path, candidate.alias);
    if (metadata) return metadata;
  }
  return null;
}

function repositoryCandidates(config, preferredWorkspace) {
  const aliases = [];
  if (preferredWorkspace) aliases.push(String(preferredWorkspace));
  aliases.push(...allWorkspaceAliases(config));
  const seen = new Set();
  const values = [];
  for (const alias of aliases) {
    if (seen.has(alias)) continue;
    seen.add(alias);
    try {
      const workspace = resolveWorkspace(config, alias);
      values.push({ alias: workspace.alias, path: workspace.path });
    } catch {}
  }
  return values;
}

function readRepositoryMetadata(root, alias = '') {
  try {
    const packageValue = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (packageValue.name !== pkg.name) return null;
    const releasePath = path.join(root, 'release-manifest.json');
    const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
    return normalizeMetadata({
      source: 'repository',
      workspace: alias,
      root,
      applicationVersion: release.applicationVersion || packageValue.version,
      packageVersion: packageValue.version,
      protocolVersion: release.protocolVersion,
      toolSurfaceVersion: release.toolSurfaceVersion,
      toolCount: release.toolCount,
      manifestHash: release.manifestHash,
      schemaVersion: release.schemaVersion,
      releaseManifestPath: releasePath
    });
  } catch {
    return null;
  }
}

function assessRuntimeCompatibility(runtime, repository, options = {}) {
  const activeTaskCount = Math.max(0, Number(options.activeTaskCount || 0));
  if (!repository) {
    return {
      available: false,
      status: 'repository_unavailable',
      compatible: true,
      restartRequired: false,
      schemaSensitiveOperationsBlocked: false,
      activeTaskCount,
      activeTasksPreventRestart: false,
      message: 'Repository release metadata is unavailable; runtime compatibility could not be compared.'
    };
  }

  const differences = [];
  compareField(differences, 'applicationVersion', runtime.applicationVersion, repository.applicationVersion);
  compareField(differences, 'packageVersion', runtime.packageVersion, repository.packageVersion);
  compareField(differences, 'protocolVersion', runtime.protocolVersion, repository.protocolVersion);
  compareField(differences, 'toolSurfaceVersion', runtime.toolSurfaceVersion, repository.toolSurfaceVersion);
  compareField(differences, 'toolCount', runtime.toolCount, repository.toolCount);
  compareField(differences, 'manifestHash', runtime.manifestHash, repository.manifestHash);
  compareField(differences, 'schemaVersion', runtime.schemaVersion, repository.schemaVersion);

  if (differences.length === 0) {
    return {
      available: true,
      status: 'compatible',
      compatible: true,
      restartRequired: false,
      schemaSensitiveOperationsBlocked: false,
      activeTaskCount,
      activeTasksPreventRestart: false,
      differences: [],
      message: 'The connected runtime matches the repository release metadata.'
    };
  }

  const order = compareVersions(runtime.applicationVersion, repository.applicationVersion);
  const repositoryAhead = order < 0 || Number(runtime.toolSurfaceVersion) < Number(repository.toolSurfaceVersion);
  const runtimeAhead = order > 0 || Number(runtime.toolSurfaceVersion) > Number(repository.toolSurfaceVersion);
  const restartRequired = repositoryAhead;
  const status = repositoryAhead ? 'restart_required' : runtimeAhead ? 'runtime_newer' : 'incompatible';
  return {
    available: true,
    status,
    compatible: false,
    restartRequired,
    schemaSensitiveOperationsBlocked: true,
    activeTaskCount,
    activeTasksPreventRestart: restartRequired && activeTaskCount > 0,
    differences,
    message: restartRequired
      ? activeTaskCount > 0
        ? 'The repository contains a newer runtime or tool surface. Finish or cancel active tasks before restarting.'
        : 'The repository contains a newer runtime or tool surface. Restart or reconnect before schema-sensitive operations.'
      : runtimeAhead
        ? 'The connected runtime is newer than the repository metadata. Reconnect to a matching repository or runtime before schema-sensitive operations.'
        : 'The runtime and repository metadata disagree. Reconnect to a matching build before schema-sensitive operations.'
  };
}

function runtimeCompatibility(config, options = {}) {
  const runtime = options.runtime || runtimeMetadata();
  const repository = options.repository === undefined
    ? repositoryMetadata(config, options.workspace)
    : options.repository;
  return {
    runtime,
    repository,
    compatibility: assessRuntimeCompatibility(runtime, repository, options)
  };
}

function assertRuntimeCompatibility(config, toolName, args = {}, options = {}) {
  if (SAFE_DURING_RUNTIME_MISMATCH.has(String(toolName || ''))) return null;
  const result = runtimeCompatibility(config, {
    workspace: args.workspace,
    activeTaskCount: options.activeTaskCount
  });
  if (!result.compatibility.schemaSensitiveOperationsBlocked) return result;
  const error = new Error(result.compatibility.message);
  error.code = 'RUNTIME_RESTART_REQUIRED';
  error.details = {
    status: result.compatibility.status,
    restartRequired: result.compatibility.restartRequired,
    activeTasksPreventRestart: result.compatibility.activeTasksPreventRestart,
    runtime: result.runtime,
    repository: result.repository,
    differences: result.compatibility.differences
  };
  throw error;
}

function toolManifestHash(surface) {
  const value = {
    schemaVersion: Number(surface.schemaVersion || 0),
    toolSurfaceVersion: Number(surface.toolSurfaceVersion || 0),
    toolCount: Number(surface.toolCount || 0),
    tools: (surface.tools || []).map(item => ({
      name: String(item.name || ''),
      state: String(item.state || 'active'),
      replacement: String(item.replacement || '')
    }))
  };
  return crypto.createHash('sha256').update(stableJson(value)).digest('base64url').slice(0, 24);
}

function normalizeMetadata(value) {
  return {
    ...value,
    applicationVersion: cleanVersion(value.applicationVersion),
    packageVersion: cleanVersion(value.packageVersion),
    protocolVersion: String(value.protocolVersion || ''),
    toolSurfaceVersion: Number(value.toolSurfaceVersion || 0),
    toolCount: Number(value.toolCount || 0),
    manifestHash: String(value.manifestHash || ''),
    schemaVersion: Number(value.schemaVersion || 0)
  };
}

function cleanVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function compareField(output, field, runtimeValue, repositoryValue) {
  if (String(runtimeValue ?? '') === String(repositoryValue ?? '')) return;
  output.push({ field, runtime: runtimeValue, repository: repositoryValue });
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

function versionParts(value) {
  const match = cleanVersion(value).match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export { PROTOCOL_VERSION, SAFE_DURING_RUNTIME_MISMATCH, assessRuntimeCompatibility, assertRuntimeCompatibility, readRepositoryMetadata, repositoryMetadata, runtimeCompatibility, runtimeMetadata, toolManifestHash };
