import assert from 'node:assert/strict';
import { canonicalPathFor, normalizeRouteKey, routeAllowsParam } from '../src/ui/route-policy.js';

assert.equal(canonicalPathFor('settings/connection'), 'connection');
assert.equal(canonicalPathFor('settings/diagnostics'), 'diagnostics');
assert.equal(canonicalPathFor('settings/general'), 'settings');
assert.equal(canonicalPathFor('settings/dashboard'), 'settings/advanced');
assert.equal(canonicalPathFor('settings/desktop'), 'settings/application');
assert.equal(canonicalPathFor('settings/skills'), 'skills');
assert.equal(canonicalPathFor('skills'), 'skills');
assert.equal(canonicalPathFor('missing'), 'home');
assert.equal(canonicalPathFor('tools'), 'tools');
assert.equal(canonicalPathFor('settings/advanced'), 'settings/advanced');
assert.equal(canonicalPathFor('settings/about'), 'settings/about');
assert.equal(canonicalPathFor('processes'), 'processes');
assert.equal(canonicalPathFor('usage'), 'usage');
assert.equal(canonicalPathFor('reference'), 'home');
assert.equal(canonicalPathFor('unknown/page'), 'home');

assert.equal(normalizeRouteKey('#activity?workspace=app&search=read&status=failed&time=24h'), 'activity?workspace=app&search=read&status=failed&time=24h');
assert.equal(normalizeRouteKey('activity?status=ok'), 'activity?status=ok');
assert.equal(normalizeRouteKey('activity?status=succeeded'), 'activity?status=succeeded');
assert.equal(normalizeRouteKey('activity?status=active'), 'activity?status=active');
assert.equal(normalizeRouteKey('activity?status=other'), 'activity?status=other');
assert.equal(normalizeRouteKey('activity?token=secret&search=hello'), 'activity?search=hello');
assert.equal(normalizeRouteKey('workspaces?focus=1'), 'workspaces');
assert.equal(normalizeRouteKey('workspaces?workspace=myapp&focus=1'), 'workspaces?workspace=myapp&focus=1');
assert.equal(normalizeRouteKey('settings/connection?workspace=app'), 'connection');

assert.equal(routeAllowsParam('activity', 'search'), true);
assert.equal(routeAllowsParam('activity', 'token'), false);
assert.equal(routeAllowsParam('settings', 'workspace'), false);

console.log('Route policy contracts passed.');
