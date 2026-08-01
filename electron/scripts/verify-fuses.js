'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';

const binaryArgument = String(process.argv[2] || '').trim();
if (!binaryArgument) {
  throw new Error('Pass the exact unpacked Rel.AI MCP executable path to verify-fuses.js. Refusing to select a potentially stale build.');
}
const binary = path.resolve(binaryArgument);
if (!fs.existsSync(binary)) throw new Error(`Electron binary not found: ${binary}`);

const expected = new Map([
  [FuseV1Options.RunAsNode, false],
  [FuseV1Options.EnableCookieEncryption, true],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, false],
  [FuseV1Options.EnableNodeCliInspectArguments, false],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true],
  [FuseV1Options.OnlyLoadAppFromAsar, true],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, false],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, false]
]);

getCurrentFuseWire(binary).then(wire => {
  for (const [option, enabled] of expected) {
    const actual = Number(wire[option]) === 49;
    if (actual !== enabled) throw new Error(`Unexpected fuse ${FuseV1Options[option]}: expected ${enabled}, received ${actual}`);
  }
  console.log(`Electron fuse policy verified for ${binary}`);
}).catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
