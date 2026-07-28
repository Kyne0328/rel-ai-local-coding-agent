// @ts-check
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @typedef {{ resourcesPath?: string }} ElectronProcess */

const electronRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(electronRoot);

/** @param {string} name @returns {string} */
function resolveResourcePath(name) {
  const resourcesPath = /** @type {ElectronProcess} */ (process).resourcesPath;
  const packagedPath = resourcesPath ? path.join(resourcesPath, name) : '';
  if (packagedPath && fs.existsSync(packagedPath)) return packagedPath;
  return path.join(repositoryRoot, name);
}

/** @param {string} name @returns {Promise<any>} */
function importResourceModule(name) {
  return import(pathToFileURL(resolveResourcePath(name)).href);
}

export { importResourceModule, resolveResourcePath };
