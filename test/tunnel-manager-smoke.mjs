import assert from 'node:assert/strict';
import tunnel from '../src/tunnelManager.js';

assert.equal(tunnel.normalizeTunnel(''), 'none');
assert.equal(tunnel.normalizeTunnel('public'), 'auto');
assert.equal(tunnel.normalizeTunnel('cloudflared'), 'cloudflare');
assert.equal(tunnel.normalizeTunnel('lt'), 'localtunnel');
assert.equal(
  tunnel.extractPublicUrl('INF + https://abc.trycloudflare.com is ready', /https:\/\/[-a-z0-9]+\.trycloudflare\.com/i),
  'https://abc.trycloudflare.com'
);
assert.equal(
  tunnel.extractPublicUrl('Forwarding https://demo.ngrok-free.app -> http://localhost:3333'),
  'https://demo.ngrok-free.app'
);
assert.equal(
  tunnel.extractPublicUrl('your url is: https://kind-rabbits.loca.lt'),
  'https://kind-rabbits.loca.lt'
);
const cfPlan = tunnel.providerPlan('cloudflare', { port: 3333, localUrl: 'http://127.0.0.1:3333' });
assert.equal(cfPlan.command, 'cloudflared');
assert.deepEqual(cfPlan.args, ['tunnel', '--url', 'http://127.0.0.1:3333']);
const customPlan = tunnel.providerPlan('custom', { command: 'my-tunnel http://127.0.0.1:3333' });
// On win32 the command is split (command='my-tunnel', args=['http://...']); on
// POSIX it is wrapped as `sh -lc <command>`. Assert on the reconstructed plan so
// the check is correct on every platform.
const customFlat = [customPlan.command, ...customPlan.args].join(' ');
assert.ok(customFlat.includes('my-tunnel') && customFlat.includes('http://127.0.0.1:3333'));
console.log('Tunnel manager smoke passed.');
