import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync('electron/main.js', 'utf8');
const serviceRuntime = fs.readFileSync('electron/service-runtime.js', 'utf8');
const serviceProcess = fs.readFileSync('electron/service-process.js', 'utf8');
const electronPackage = JSON.parse(fs.readFileSync('electron/package.json', 'utf8'));
const policy = JSON.parse(fs.readFileSync('.github/relai/support-policy.json', 'utf8'));
const httpServer = fs.readFileSync('src/httpServer.js', 'utf8');

assert.match(policy.minimumSupportedVersion, /^\d+\.\d+\.\d+$/, 'support policy must declare a stable minimum supported version');
assert.match(policy.minimumRecommendedVersion, /^\d+\.\d+\.\d+$/, 'support policy must declare a stable recommended version');
assert.equal(electronPackage.build.files.includes('update-support-policy.js'), true);
assert.match(main, /createUpdateSupportPolicy/);
assert.match(main, /function combinedUpdateStatus/);
assert.match(main, /function combineUpdateActionResult/);
assert.match(main, /checkForUpdates: checkApplicationUpdates/);
assert.match(main, /supportPolicy:\s*updateSupportPolicy\?\.getStatus\(\)/);
assert.match(main, /updateSupportPolicy\.start\(\)/);
assert.match(main, /updateSupportPolicy\?\.stop\(\)/);
assert.match(main, /getRuntimeAccess:\s*updateRuntimeAccess/);
assert.match(main, /errorCode:\s*ERROR_CODES\.UPDATE_REQUIRED/, 'blocking support policy must produce the update-required runtime error');
assert.match(serviceRuntime, /runtimeAccess:\s*getRuntimeAccess\(\)/, 'desktop runtime must forward the current support-policy gate to the service process');
assert.match(serviceProcess, /getRuntimeAccess:\s*\(\)\s*=>\s*desktopContext\.runtimeAccess/, 'the utility-process HTTP server must enforce the forwarded support-policy runtime gate');
assert.match(httpServer, /getRuntimeAccess/);
assert.match(httpServer, /426/);

console.log('Remote update support policy integration contracts passed.');
