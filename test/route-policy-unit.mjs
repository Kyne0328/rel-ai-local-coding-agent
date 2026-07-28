import assert from 'node:assert/strict';
import { canonicalPathFor, normalizeRouteKey, routeAllowsParam } from '../src/ui/route-policy.js';

assert.equal(canonicalPathFor('reference'), 'tools');
assert.equal(canonicalPathFor('settings/desktop'), 'settings/connection');
assert.equal(canonicalPathFor('settings/dashboard'), 'settings/advanced');
assert.equal(canonicalPathFor('settings/about'), 'settings/about');
assert.equal(canonicalPathFor('processes'), 'processes');
assert.equal(canonicalPathFor('unknown/page'), 'home');

assert.equal(normalizeRouteKey(''), 'home');
assert.equal(normalizeRouteKey('#REFERENCE'), 'tools');
assert.equal(normalizeRouteKey('connection'), 'settings/connection');
assert.equal(normalizeRouteKey('settings/unknown?workspace=demo'), 'home');
assert.equal(normalizeRouteKey('workspaces?workspace=demo&focus=1'), 'workspaces?workspace=demo&focus=1');
assert.equal(normalizeRouteKey('processes?workspace=demo'), 'processes?workspace=demo');
assert.equal(normalizeRouteKey('workspaces?focus=1'), 'workspaces');
assert.equal(normalizeRouteKey('activity?time=24h&status=error&search=failed%20check'), 'activity?time=24h&status=error&search=failed+check');
assert.equal(normalizeRouteKey('activity?time=invalid&status=warning&tool=relai_read'), 'activity?tool=relai_read');
assert.equal(normalizeRouteKey('settings/diagnostics?workspace=demo'), 'settings/diagnostics?workspace=demo');
assert.equal(normalizeRouteKey('settings/about'), 'settings/about');
assert.equal(normalizeRouteKey('settings?workspace=demo'), 'settings');
assert.equal(normalizeRouteKey('activity?token=secret&bootstrap=code&search=ok'), 'activity?search=ok');
assert.equal(normalizeRouteKey('home?workspace=bad%20alias'), 'home');
assert.equal(normalizeRouteKey('home?workspace=demo&workspace=other'), 'home?workspace=demo');
assert.equal(routeAllowsParam('activity', 'event'), true);
assert.equal(routeAllowsParam('processes', 'workspace'), true);
assert.equal(routeAllowsParam('settings', 'workspace'), false);

console.log('Route policy unit tests passed.');
