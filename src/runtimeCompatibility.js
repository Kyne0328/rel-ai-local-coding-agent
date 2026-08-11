'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { MCP_PROTOCOL_VERSION } from './mcp/protocol.js';
import { packageMetadata as pkg } from './packageMetadata.js';
import { getVersion } from './version.js';
import { getToolSurfaceManifest } from './tools/schema.js';
import { allWorkspaceAliases, resolveWorkspace } from './config.js';
import { buildToolManifest } from './mcp/toolManifest.js';
import { GATEWAY_PROTOCOL_VERSION, MINIMUM_GATEWAY_PROTOCOL_VERSION } from './gateway/protocol.js';

const PROTOCOL_VERSION = MCP_PROTOCOL_VERSION;
function runtimeMetadata() {
  const surface = getToolSurfaceManifest();
  const manifest = buildToolManifest();
  return normalizeMetadata({
    source: 'runtime',
    applicationVersion: getVersion(),
    packageVersion: pkg.version,
    protocolVersion: PROTOCOL_VERSION,
    toolSurfaceVersion: surface.toolSurfaceVersion,
    toolCount: manifest.activeToolCount,
    manifestHash: manifest.version,
    schemaVersion: manifest.schemaVersion,
    deviceProtocolVersion: GATEWAY_PROTOCOL_VERSION,
    minimumCompatibleDeviceProtocol: MINIMUM_GATEWAY_PROTOCOL_VERSION
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
      deviceProtocolVersion: release.deviceProtocolVersion,
      minimumCompatibleDeviceProtocol: release.minimumCompatibleDeviceProtocol,
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
      advisoryOnly: true,
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
  compareField(differences, 'deviceProtocolVersion', runtime.deviceProtocolVersion, repository.deviceProtocolVersion);
  compareField(differences, 'minimumCompatibleDeviceProtocol', runtime.minimumCompatibleDeviceProtocol, repository.minimumCompatibleDeviceProtocol);

  if (differences.length === 0) {
    return {
      available: true,
      status: 'compatible',
      compatible: true,
      restartRequired: false,
      schemaSensitiveOperationsBlocked: false,
      advisoryOnly: true,
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
    schemaSensitiveOperationsBlocked: false,
    advisoryOnly: true,
    activeTaskCount,
    activeTasksPreventRestart: restartRequired && activeTaskCount > 0,
    differences,
    message: restartRequired
      ? activeTaskCount > 0
        ? 'The repository contains a newer runtime or tool surface. Tools remain available; finish active work before restarting when convenient.'
        : 'The repository contains a newer runtime or tool surface. Tools remain available; restart or reconnect when convenient to load the new surface.'
      : runtimeAhead
        ? 'The connected runtime is newer than the repository metadata. Tools remain available; reconnect to a matching repository or runtime when convenient.'
        : 'The runtime and repository metadata disagree. Tools remain available; reconnect to a matching build when convenient.'
  };
}

function runtimeCompatibility(config, options = {}) {
  const runtime = options.runtime || runtimeMetadata(config);
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
  // Runtime/repository drift is expected while Rel.AI edits its own checkout.
  // Keep this comparison observable, but never let it revoke the tool surface
  // that is needed to finish or repair the in-progress change.
  return runtimeCompatibility(config, {
    workspace: args.workspace,
    activeTaskCount: options.activeTaskCount
  });
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
    schemaVersion: Number(value.schemaVersion || 0),
    deviceProtocolVersion: Number(value.deviceProtocolVersion || 0),
    minimumCompatibleDeviceProtocol: Number(value.minimumCompatibleDeviceProtocol || 0)
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


export {  assessRuntimeCompatibility, assertRuntimeCompatibility, readRepositoryMetadata,  runtimeCompatibility, runtimeMetadata,  };
