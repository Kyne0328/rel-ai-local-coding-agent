'use strict';

import * as path from 'node:path';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

export default async function hardenElectronBinary(context) {
  const executable = resolveExecutable(context);
  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
  });
};

function resolveExecutable(context) {
  const productName = context.packager.appInfo.productFilename;
  if (context.electronPlatformName === 'darwin') {
    return path.join(context.appOutDir, `${productName}.app`, 'Contents', 'MacOS', productName);
  }
  return path.join(context.appOutDir, `${productName}${context.electronPlatformName === 'win32' ? '.exe' : ''}`);
}
