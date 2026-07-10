const fs = require('node:fs');
const path = require('node:path');

function resolveResourcePath(name) {
  const packagedPath = process.resourcesPath ? path.join(process.resourcesPath, name) : '';
  if (packagedPath && fs.existsSync(packagedPath)) return packagedPath;
  return path.join(__dirname, '..', name);
}

module.exports = { resolveResourcePath };
