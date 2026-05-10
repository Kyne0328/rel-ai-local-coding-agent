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
assert.ok(customPlan.args.includes('my-tunnel http://127.0.0.1:3333'));
console.log('Tunnel manager smoke passed.');
