'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
import { resolveCurrentUnpacked } from '../../scripts/current-unpacked.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const binary = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(resolveCurrentUnpacked(root, { allowBuildCheck: true }), 'Rel.AI MCP.exe');
if (!binary || !fs.existsSync(binary)) throw new Error(`Electron binary not found: ${binary || '(missing path)'}`);

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
