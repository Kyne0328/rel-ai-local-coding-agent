import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runNpm } from './npm-cli.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'sbom.cdx.json');

function nativeReleaseComponents(tunnelManifest, zoektManifest) {
  return [
    ...platformArtifacts(tunnelManifest.platforms).map(({ platform, arch, artifact }) => ({
      type: 'application',
      'bom-ref': `pkg:generic/openai-tunnel-client@${tunnelManifest.version}?arch=${encodeURIComponent(arch)}&os=${encodeURIComponent(platform)}`,
      name: 'OpenAI tunnel-client',
      version: tunnelManifest.version,
      supplier: { name: 'OpenAI' },
      licenses: [{ license: { id: tunnelManifest.license } }],
      hashes: [{ alg: 'SHA-256', content: artifact.sha256 }],
      externalReferences: [
        { type: 'distribution', url: `${tunnelManifest.baseUrl}/${artifact.archive}` },
        { type: 'vcs', url: tunnelManifest.source }
      ],
      properties: [
        { name: 'rel.ai.platform', value: platform },
        { name: 'rel.ai.arch', value: arch },
        { name: 'rel.ai.file', value: artifact.file }
      ]
    })),
    ...zoektArtifacts(zoektManifest).map(({ platform, arch, role, artifact }) => ({
      type: 'application',
      'bom-ref': `pkg:generic/sourcegraph-zoekt@${zoektManifest.upstream.commit}?arch=${encodeURIComponent(arch)}&os=${encodeURIComponent(platform)}&role=${role}`,
      name: role === 'search' ? 'Zoekt search' : 'Zoekt index',
      version: zoektManifest.upstream.commit,
      licenses: [{ license: { id: zoektManifest.upstream.license } }],
      hashes: [{ alg: 'SHA-256', content: artifact.sha256 }],
      externalReferences: [{ type: 'vcs', url: zoektManifest.upstream.repository }],
      properties: [
        { name: 'rel.ai.platform', value: platform },
        { name: 'rel.ai.arch', value: arch },
        { name: 'rel.ai.file', value: artifact.file },
        { name: 'rel.ai.patchSet', value: zoektManifest.upstream.patchSet }
      ]
    }))
  ];
}

function platformArtifacts(platforms) {
  const results = [];
  for (const [platform, platformSpec] of Object.entries(platforms || {})) {
    if (platformSpec.architectures) {
      for (const [arch, artifact] of Object.entries(platformSpec.architectures)) {
        results.push({ platform, arch, artifact });
      }
    } else {
      results.push({ platform, arch: normalizeManifestArch(platformSpec.architecture || 'x64'), artifact: platformSpec });
    }
  }
  return results;
}

function zoektArtifacts(manifest) {
  const results = [];
  for (const [platform, platformSpec] of Object.entries(manifest.platforms || {})) {
    const variants = platformSpec.architectures ? Object.entries(platformSpec.architectures) : [[normalizeManifestArch(platformSpec.architecture || 'x64'), platformSpec]];
    for (const [declaredArch, spec] of variants) {
      const arch = normalizeManifestArch(declaredArch || spec.architecture);
      for (const role of ['search', 'index']) {
        if (spec[role]) results.push({ platform, arch, role, artifact: spec[role] });
      }
    }
  }
  return results;
}

function normalizeManifestArch(value) {
  const arch = String(value || '').trim().toLowerCase();
  if (arch === 'amd64') return 'x64';
  if (arch === 'aarch64') return 'arm64';
  return arch || 'x64';
}

function generateSbom() {
  const result = runNpm(['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev', '--package-lock-only'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || 'npm sbom failed.\n');
    process.exitCode = result.status || 1;
    return;
  }

  const document = JSON.parse(result.stdout);
  const tunnelManifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'tunnel-client', 'manifest.json'), 'utf8'));
  const zoektManifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'zoekt', 'manifest.json'), 'utf8'));
  const nativeComponents = nativeReleaseComponents(tunnelManifest, zoektManifest);
  const byReference = new Map((document.components || []).map(component => [component['bom-ref'], component]));
  for (const component of nativeComponents) byReference.set(component['bom-ref'], component);
  document.components = [...byReference.values()];

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Generated ${path.relative(root, output)} with ${nativeComponents.length} pinned native release components.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generateSbom();

export { nativeReleaseComponents, normalizeManifestArch, platformArtifacts, zoektArtifacts };
