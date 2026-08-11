import fs from 'node:fs';
import path from 'node:path';

function createWindowsUpdaterConfig(manifest) {
  const publish = Array.isArray(manifest?.build?.publish)
    ? manifest.build.publish[0]
    : manifest?.build?.publish;
  if (!publish || publish.provider !== 'github') {
    throw new Error('Windows automatic updates require a GitHub publish configuration.');
  }
  const name = String(manifest?.name || '').trim();
  if (!name) throw new Error('Electron package name is required for the updater cache directory.');
  return {
    ...publish,
    updaterCacheDirName: `${name.toLowerCase()}-updater`
  };
}

function writeWindowsUpdaterConfig({ appDirectory, manifest }) {
  const resourcesDirectory = path.join(appDirectory, 'resources');
  if (!fs.existsSync(resourcesDirectory) || !fs.statSync(resourcesDirectory).isDirectory()) {
    throw new Error(`Packaged application resources are missing: ${resourcesDirectory}.`);
  }
  const destination = path.join(resourcesDirectory, 'app-update.yml');
  const config = createWindowsUpdaterConfig(manifest);
  const yaml = `${Object.entries(config)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${yamlScalar(value)}`)
    .join('\n')}\n`;
  fs.writeFileSync(destination, yaml, 'utf8');
  return destination;
}

function yamlScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const text = String(value);
  return /^[A-Za-z0-9._/-]+$/.test(text) ? text : JSON.stringify(text);
}

export { createWindowsUpdaterConfig, writeWindowsUpdaterConfig };
