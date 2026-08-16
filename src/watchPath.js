import * as fs from 'node:fs';

function watchPathFor(target, platform = process.platform) {
  const value = String(target);
  return platform === 'win32' ? fs.realpathSync.native(value) : value;
}

export { watchPathFor };
