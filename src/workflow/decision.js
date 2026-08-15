import { deterministicActionId } from './contracts.js';

function decideWorkflow(facts = {}) {
  const boundary = facts.boundary || { level: 'file', changedFiles: [], affectedTests: [] };
  const risk = facts.risk || { level: 'low', reasons: [] };
  const completion = facts.completion || { hardReady: false, blockers: [] };
  const evidence = facts.evidence || { fresh: 0, stale: 0, reusable: 0 };
  const repeatCount = Number(facts.repeatCount || 0);
  const changed = Array.isArray(boundary.changedFiles) && boundary.changedFiles.length > 0;
  const affectedTests = Array.isArray(boundary.affectedTests) ? boundary.affectedTests : [];
  const reviewFresh = facts.reviewFresh === true;
  const recommendations = [];
  const avoid = [];
  let stage;

  if (repeatCount >= 2) {
    stage = 'repair';
    recommendations.push(action('relai_inspect', 'impact', 'Repeated failure detected across task mutations; inspect the failure boundary and root-cause hypothesis before another edit.', { paths: boundary.changedFiles || [] }, 'small'));
    avoid.push({ action: 'repeat the same repair approach', reason: 'The same failure family has survived multiple mutations; gather new evidence before another similar edit.' });
  } else if (!changed) {
    if (facts.intent === 'investigation' && completion.hardReady) stage = 'complete';
    else stage = facts.intent === 'feature' ? 'design' : 'investigate';
  } else if (completion.hardReady && (reviewFresh || facts.intent === 'documentation')) {
    if (facts.intent === 'documentation' && !reviewFresh) {
      stage = 'review';
      recommendations.push(action('relai_changes', 'diff', 'Review the exact task-owned documentation change before completion.', { scope: 'task' }, 'small'));
    } else stage = 'complete';
  } else if (evidence.reusable > 0 && completion.hardReady) {
    stage = reviewFresh ? 'complete' : 'review';
    if (!reviewFresh) recommendations.push(action('relai_changes', 'diff', 'Validation evidence is current; review task-owned changes next.', { scope: 'task' }, 'small'));
  } else if (affectedTests.length) {
    stage = 'verify';
    recommendations.push(action('relai_validate', 'checks', 'Directly affected test has not passed for the current repository fingerprint.', { check: affectedTests[0] }, 'small'));
  } else if (risk.level === 'low' && facts.intent === 'documentation') {
    stage = 'review';
    recommendations.push(action('relai_changes', 'diff', 'Review the exact task-owned change; broader validation is not indicated by the current risk.', { scope: 'task' }, 'small'));
  } else {
    stage = completion.blockers?.length ? 'verify' : 'review';
    recommendations.push(action(stage === 'verify' ? 'relai_validate' : 'relai_changes', stage === 'verify' ? 'checks' : 'diff', stage === 'verify' ? 'Run the cheapest relevant validation for the affected boundary.' : 'Review the task-owned diff.', stage === 'verify' ? {} : { scope: 'task' }, 'medium'));
  }

  if (!['release', 'repository', 'cross_package'].includes(boundary.level)) {
    avoid.push({ action: 'release validation', reason: `Current boundary is ${boundary.level}; release-wide checks are not indicated.` });
  }
  if (facts.liveMatchingProcess) avoid.push({ action: 'start duplicate process', reason: 'An exact same-task managed process is already active.' });
  return { stage, recommendedActions: recommendations.slice(0, 5), avoidActions: avoid.slice(0, 10) };
}

function action(tool, actionName, reason, args, estimatedCost) {
  const value = { priority: 1, tool, action: actionName, reason, blocking: false, estimatedCost, args };
  return { id: deterministicActionId(value), ...value };
}

export { decideWorkflow };