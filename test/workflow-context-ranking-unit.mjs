import assert from 'node:assert/strict';
import { rankMatchGroups } from '../src/bridge/searchPlanner.js';

const groups = [
  { path: 'back-end/src/user.js', matches: [{ line: 1 }] },
  { path: 'front-end/src/user-card.js', matches: [{ line: 1 }] },
  { path: 'shared/user.js', matches: [{ line: 1 }, { line: 2 }] }
];
const ranked = rankMatchGroups(groups, 'user', {
  packagePaths: ['front-end'],
  taskOwnedPaths: ['front-end/src/user-card.js'],
  impactedPaths: ['shared/user.js']
});
assert.equal(ranked[0].path, 'front-end/src/user-card.js', 'task-owned/current-package matches should receive a ranking boost');
assert.deepEqual(new Set(ranked.map(item => item.path)), new Set(groups.map(item => item.path)), 'workflow ranking must not hard-filter search results');

console.log('Workflow-aware context ranking tests passed.');