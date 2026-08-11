import assert from 'node:assert/strict';

import { decideWorkflow } from '../src/workflow/decision.js';

const docs = decideWorkflow({ intent: 'documentation', boundary: { level: 'file', changedFiles: ['README.md'], affectedTests: [] }, risk: { level: 'low', reasons: [] }, completion: { hardReady: true, blockers: [] }, evidence: { fresh: 0, stale: 0, reusable: 0 }, repeatCount: 0 });
assert.equal(docs.stage, 'review');
assert.equal(docs.recommendedActions[0]?.tool, 'relai_changes');
assert.ok(docs.avoidActions.some(item => /release validation/i.test(item.action)));

const localBug = decideWorkflow({ intent: 'bugfix', boundary: { level: 'package', packageIds: ['npm:front-end'], changedFiles: ['front-end/src/app.js'], affectedTests: ['front-end/test/app.test.js'] }, risk: { level: 'medium', reasons: [] }, completion: { hardReady: false, blockers: ['validation'] }, evidence: { fresh: 0, stale: 0, reusable: 0 }, repeatCount: 0 });
assert.equal(localBug.stage, 'verify');
assert.equal(localBug.recommendedActions[0]?.tool, 'relai_validate');
assert.match(localBug.recommendedActions[0]?.reason || '', /affected test/i);

const reusable = decideWorkflow({ intent: 'bugfix', boundary: { level: 'package', packageIds: ['npm:front-end'], changedFiles: ['front-end/src/app.js'], affectedTests: ['front-end/test/app.test.js'] }, risk: { level: 'medium', reasons: [] }, completion: { hardReady: true, blockers: [] }, evidence: { fresh: 1, stale: 0, reusable: 1 }, repeatCount: 0, reviewFresh: true });
assert.equal(reusable.stage, 'complete');
assert.equal(reusable.recommendedActions.length, 0);

const repeated = decideWorkflow({ intent: 'bugfix', boundary: { level: 'package', changedFiles: ['src/app.js'], affectedTests: ['test/app.test.js'] }, risk: { level: 'medium', reasons: [] }, completion: { hardReady: false, blockers: ['validation'] }, evidence: { fresh: 0, stale: 0, reusable: 0 }, repeatCount: 2 });
assert.equal(repeated.stage, 'repair');
assert.equal(repeated.recommendedActions[0]?.tool, 'relai_inspect');
assert.ok(repeated.avoidActions.some(item => /repeat/i.test(item.action)));

const investigation = decideWorkflow({ intent: 'investigation', boundary: { level: 'file', changedFiles: [] }, risk: { level: 'low', reasons: [] }, completion: { hardReady: true, blockers: [] }, evidence: { fresh: 1, stale: 0, reusable: 0 }, repeatCount: 0 });
assert.equal(investigation.stage, 'complete');

const crossPackage = decideWorkflow({ intent: 'refactor', boundary: { level: 'cross_package', packageIds: ['npm:a', 'npm:b'], changedFiles: ['a/src/x.js', 'b/src/y.js'], affectedTests: [] }, risk: { level: 'high', reasons: ['shared contract'] }, completion: { hardReady: false, blockers: ['validation'] }, evidence: { fresh: 0, stale: 0, reusable: 0 }, repeatCount: 0 });
assert.equal(crossPackage.stage, 'verify');
assert.equal(crossPackage.recommendedActions[0]?.tool, 'relai_validate');

const liveProcess = decideWorkflow({ intent: 'investigation', boundary: { level: 'file', changedFiles: [] }, risk: { level: 'low', reasons: [] }, completion: { hardReady: false, blockers: [] }, evidence: { fresh: 0, stale: 0, reusable: 0 }, repeatCount: 0, liveMatchingProcess: true });
assert.ok(liveProcess.avoidActions.some(item => /duplicate process/i.test(item.action)));
console.log('Pure workflow decision scenarios passed.');