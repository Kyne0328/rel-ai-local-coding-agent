import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseArtifactNames } from './release-artifacts.mjs';
import { verifyUpdaterArtifacts } from './verify-updater-artifacts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function prepareReleaseAssets(directory = path.join(root, 'dist')) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const names = releaseArtifactNames(version);
  const assets = [
    names.installer,
    names.portable,
    names.blockmap,
    names.metadata,
    names.linuxAppImage,
    names.linuxDeb,
    names.linuxMetadata,
    names.sbom,
    names.sizeReport,
    names.linuxSizeReport
  ];
  for (const name of assets) requireFile(path.join(directory, name), `Required release asset ${name}`);

  const checksums = assets.slice().sort().map(name => {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex');
    return `${digest}  ${name}`;
  });
  fs.writeFileSync(path.join(directory, names.checksums), `${checksums.join('\n')}\n`, 'ascii');
  const listed = [...assets, names.checksums];
  const assetList = path.join(directory, 'release-assets.txt');
  fs.writeFileSync(assetList, `${listed.join('\n')}\n`, 'utf8');

  const windowsVerification = verifyUpdaterArtifacts({
    directory,
    assetList,
    metadata: names.metadata,
    checksums: names.checksums,
    requireBlockmaps: true
  });
  const linuxVerification = verifyUpdaterArtifacts({
    directory,
    assetList,
    metadata: names.linuxMetadata,
    checksums: names.checksums,
    requireBlockmaps: false
  });
  return { version, assets: listed, verification: { windows: windowsVerification, linux: linuxVerification } };
}

function requireFile(file, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} is missing: ${file}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const directoryIndex = process.argv.indexOf('--dir');
    const directory = directoryIndex >= 0 ? path.resolve(root, String(process.argv[directoryIndex + 1] || '')) : path.join(root, 'dist');
    const result = prepareReleaseAssets(directory);
    console.log(`Prepared and verified ${result.assets.length} Windows and Linux release assets for ${result.version}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { prepareReleaseAssets };
