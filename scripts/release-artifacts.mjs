import fs from 'node:fs';
import path from 'node:path';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function releaseArtifactNames(version) {
  const normalizedVersion = String(version || '').trim();
  if (!VERSION_PATTERN.test(normalizedVersion)) {
    throw new Error(`Invalid release version: ${normalizedVersion || '(empty)'}.`);
  }
  const installer = `Rel.AI-MCP-Setup-${normalizedVersion}.exe`;
  return {
    installer,
    portable: `Rel.AI-MCP-Portable-${normalizedVersion}.exe`,
    blockmap: `${installer}.blockmap`,
    metadata: 'latest.yml',
    linuxAppImage: `Rel.AI-MCP-${normalizedVersion}-linux-x64.AppImage`,
    linuxDeb: `Rel.AI-MCP-${normalizedVersion}-linux-x64.deb`,
    linuxMetadata: 'latest-linux.yml',
    macDmgX64: `Rel.AI-MCP-${normalizedVersion}-mac-x64.dmg`,
    macDmgArm64: `Rel.AI-MCP-${normalizedVersion}-mac-arm64.dmg`,
    checksums: 'SHA256SUMS.txt',
    sbom: 'sbom.cdx.json',
    sizeReport: 'electron-size-report.json',
    linuxSizeReport: 'electron-size-report-linux.json'
  };
}

function invalidateDerivedReleaseEvidence(directory, version) {
  const names = releaseArtifactNames(version);
  const removed = [];
  for (const name of [names.checksums, names.sbom, names.sizeReport, names.linuxSizeReport, 'release-assets.txt']) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file, { force: true, maxRetries: 5, retryDelay: 200 });
    removed.push(name);
  }
  return removed;
}

function parseLatestMetadata(source) {
  const lines = String(source || '').split(/\r?\n/);
  const files = [];
  let inFiles = false;
  let current = null;
  let topLevelPath = '';
  let topLevelSha512 = '';

  for (const rawLine of lines) {
    if (/^files:\s*$/.test(rawLine)) {
      inFiles = true;
      current = null;
      continue;
    }
    const fileMatch = rawLine.match(/^\s*-\s+(?:url|path):\s*(.+?)\s*$/);
    if (inFiles && fileMatch) {
      current = { basename: artifactBasename(parseYamlScalar(fileMatch[1])), sha512: '' };
      files.push(current);
      continue;
    }
    const indentedSha = rawLine.match(/^\s+sha512:\s*(.+?)\s*$/);
    if (inFiles && current && indentedSha) {
      current.sha512 = parseYamlScalar(indentedSha[1]);
      continue;
    }
    if (/^\S/.test(rawLine) && !/^files:\s*$/.test(rawLine)) {
      inFiles = false;
      current = null;
    }
    const pathMatch = rawLine.match(/^path:\s*(.+?)\s*$/);
    if (pathMatch) topLevelPath = artifactBasename(parseYamlScalar(pathMatch[1]));
    const shaMatch = rawLine.match(/^sha512:\s*(.+?)\s*$/);
    if (shaMatch) topLevelSha512 = parseYamlScalar(shaMatch[1]);
  }

  if (topLevelPath) {
    const existing = files.find(file => file.basename === topLevelPath);
    if (existing) {
      if (!existing.sha512) existing.sha512 = topLevelSha512;
    } else {
      files.push({ basename: topLevelPath, sha512: topLevelSha512 });
    }
  }
  if (files.length === 0) throw new Error('latest.yml does not reference an update artifact.');
  for (const file of files) {
    if (!file.basename) throw new Error('latest.yml contains an empty update artifact name.');
    if (!file.sha512) throw new Error(`latest.yml does not contain SHA-512 for ${file.basename}.`);
  }
  return files;
}

function parseChecksumManifest(source) {
  const checksums = new Map();
  for (const rawLine of String(source || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([a-fA-F0-9]{64})\s+[* ]?(.+)$/);
    if (!match) throw new Error(`Invalid SHA256SUMS.txt line: ${rawLine}`);
    const basename = exactBasename(match[2].trim());
    if (checksums.has(basename)) throw new Error(`Duplicate SHA-256 entry: ${basename}.`);
    checksums.set(basename, match[1].toLowerCase());
  }
  return checksums;
}

function parseAssetList(source) {
  const names = String(source || '')
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(exactBasename);
  const unique = new Set(names);
  if (unique.size !== names.length) throw new Error('Release asset list contains duplicate basenames.');
  return unique;
}

function parseYamlScalar(value) {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function artifactBasename(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  let pathname = normalized;
  try {
    pathname = new URL(normalized, 'https://release.invalid/').pathname;
  } catch {}
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {}
  return exactBasename(path.posix.basename(decoded));
}

function exactBasename(value) {
  const name = String(value || '').trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`Release asset must be an exact basename: ${name || '(empty)'}.`);
  }
  return name;
}

export {
  exactBasename,
  invalidateDerivedReleaseEvidence,
  parseAssetList,
  parseChecksumManifest,
  parseLatestMetadata,
  releaseArtifactNames
};
