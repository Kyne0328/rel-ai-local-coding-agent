// @ts-check
const fs = require('node:fs');
const path = require('node:path');

/** @typedef {{ resourcesPath?: string }} ElectronProcess */

/** @param {string} name @returns {string} */
function resolveResourcePath(name) {
  const resourcesPath = /** @type {ElectronProcess} */ (process).resourcesPath;
  const packagedPath = resourcesPath ? path.join(resourcesPath, name) : '';
  if (packagedPath && fs.existsSync(packagedPath)) return packagedPath;
  return path.join(__dirname, '..', name);
}

module.exports = { resolveResourcePath };
