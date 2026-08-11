import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync('electron/main.js', 'utf8');
const electronPackage = JSON.parse(fs.readFileSync('electron/package.json', 'utf8'));
const policy = JSON.parse(fs.readFileSync('.github/relai/support-policy.json', 'utf8'));
const httpServer = fs.readFileSync('src/httpServer.js', 'utf8');

assert.equal(policy.minimumSupportedVersion, '0.25.0');
assert.equal(policy.minimumRecommendedVersion, '0.25.0');
assert.equal(electronPackage.build.files.includes('update-support-policy.js'), true);
assert.match(main, /createUpdateSupportPolicy/);
assert.match(main, /function combinedUpdateStatus/);
assert.match(main, /function combineUpdateActionResult/);
assert.match(main, /checkForUpdates: checkApplicationUpdates/);
assert.match(main, /supportPolicy:\s*updateSupportPolicy\?\.getStatus\(\)/);
assert.match(main, /updateSupportPolicy\.start\(\)/);
assert.match(main, /updateSupportPolicy\?\.stop\(\)/);
assert.match(main, /getRuntimeAccess:\s*updateRuntimeAccess/);
assert.match(main, /code:\s*'UPDATE_REQUIRED'/, 'Cloud gateway requests must honor a blocking support policy');
assert.match(httpServer, /getRuntimeAccess/);
assert.match(httpServer, /426/);

console.log('Remote update support policy integration contracts passed.');
