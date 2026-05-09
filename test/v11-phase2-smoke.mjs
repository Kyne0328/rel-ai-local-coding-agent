#!/usr/bin/env node
// Phase 2 HTTP smoke tests
import http from 'node:http';

const BASE = process.env.TEST_BASE || 'http://localhost:3333';
const TOKEN = process.env.TEST_TOKEN || '';

async function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    if (TOKEN) u.searchParams.set('token', TOKEN);
    const data = body ? JSON.stringify(body) : null;
    const opts = { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch (_) { resolve({ status: res.statusCode, body: raw }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let pass = 0, fail = 0;
function assert(label, cond) { if (cond) { console.log('✓', label); pass++; } else { console.error('✗', label); fail++; } }

// GET /api/tools
const tools = await req('GET', '/api/tools');
assert('GET /api/tools returns 200', tools.status === 200);
assert('GET /api/tools returns array', Array.isArray(tools.body));
assert('GET /api/tools items have name', tools.body[0] && typeof tools.body[0].name === 'string');

// GET /api/onboarding/status
const onb = await req('GET', '/api/onboarding/status');
assert('GET /api/onboarding/status returns 200', onb.status === 200);
assert('GET /api/onboarding/status has needsOnboarding', typeof onb.body.needsOnboarding === 'boolean');

// POST /api/onboarding/complete
const onbComplete = await req('POST', '/api/onboarding/complete', { completed: true });
assert('POST /api/onboarding/complete returns 200', onbComplete.status === 200);
assert('POST /api/onboarding/complete ok', onbComplete.body.ok === true);

// POST /api/approvals/:id/decision — non-existent id should 404 or 400, not 500
const appr = await req('POST', '/api/approvals/nonexistent-id/decision', { status: 'approved' });
assert('POST /api/approvals/:id/decision rejects bad id gracefully', appr.status === 400 || appr.status === 404);

// configEditor dryRun (internal — tested via POST /api/settings with dryRun flag)
const dry = await req('POST', '/api/settings', { dryRun: true, permissionProfile: 'pr' });
assert('POST /api/settings dryRun returns changes array', Array.isArray(dry.body.changes));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
