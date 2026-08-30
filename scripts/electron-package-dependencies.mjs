import fs from 'node:fs';
import path from 'node:path';
import { verifyNodePtyPackage } from './verify-node-pty-runtime.mjs';

function assertInstalledElectronDependencies({ electronRoot, manifest, lockfile }) {
  const rootEntry = lockfile?.packages?.[''];
  if (!rootEntry) throw new Error('electron/package-lock.json is missing its root package entry. Run "npm ci" in electron/.');

  const failures = [];
  let checked = 0;
  for (const section of ['dependencies', 'devDependencies']) {
    const declared = manifest?.[section] || {};
    const lockedDeclarations = rootEntry?.[section] || {};
    for (const [name, requested] of Object.entries(declared)) {
      checked += 1;
      if (lockedDeclarations[name] !== requested) {
        failures.push(`${name}: electron/package.json requests ${requested}, but electron/package-lock.json records ${lockedDeclarations[name] || '(missing)'}`);
        continue;
      }

      const lockedPackage = lockfile?.packages?.[`node_modules/${name}`];
      const lockedVersion = String(lockedPackage?.version || '').trim();
      if (!lockedVersion) {
        failures.push(`${name}: electron/package-lock.json has no resolved package version`);
        continue;
      }

      const installedManifestPath = path.join(electronRoot, 'node_modules', ...name.split('/'), 'package.json');
      if (!fs.existsSync(installedManifestPath)) {
        failures.push(`${name}: package is not installed; lockfile resolves ${lockedVersion}`);
        continue;
      }

      let installedVersion;
      try {
        installedVersion = String(JSON.parse(fs.readFileSync(installedManifestPath, 'utf8'))?.version || '').trim();
      } catch (error) {
        failures.push(`${name}: installed package metadata could not be read (${error.message || error})`);
        continue;
      }
      if (installedVersion !== lockedVersion) {
        failures.push(`${name}: installed ${installedVersion || '(unknown)'}, lockfile resolves ${lockedVersion}`);
      }
    }
  }

  if (failures.length) {
    throw new Error(`Electron packaging dependencies do not match the committed lockfile:\n  - ${failures.join('\n  - ')}\nRun "npm ci" in electron/ before packaging.`);
  }
  if (manifest?.dependencies?.['node-pty']) {
    try {
      verifyNodePtyPackage(path.join(electronRoot, 'node_modules', 'node-pty'), { label: 'Electron node-pty' });
    } catch (error) {
      throw new Error(
        `Electron packaging dependencies are installed but node-pty's native runtime is unavailable. `
        + `Approve node-pty@${manifest.dependencies['node-pty']} in electron/package.json allowScripts and rerun npm ci in electron/.`,
        { cause: error }
      );
    }
  }
  return Object.freeze({ checked });
}

export { assertInstalledElectronDependencies };
