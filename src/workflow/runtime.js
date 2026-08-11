import { buildCheckCatalog } from './checkCatalog.js';
import { normalizeWorkflowSnapshot } from './contracts.js';
import { decideWorkflow } from './decision.js';
import { repeatFailureCount } from './evidence.js';
import { classifyWorkflowRisk } from './risk.js';
import { discoverRepositoryTopology, packageForPath } from './topology.js';

async function buildWorkflowSnapshot(input = {}) {
  const integrity = input.taskIntegrity || {};
  const changedFiles = unique(integrity.taskOwnedChangedFiles || input.changedFiles || []);
  const topology = input.topology || discoverRepositoryTopology(input.workspace?.path || '.');
  const packageIds = unique(changedFiles.map(file => packageForPath(topology, file)?.id).filter(Boolean));
  const affectedTests = unique(input.affectedTests || []);
  const impactedPaths = unique(input.impactedPaths || []);
  const classification = classifyWorkflowRisk({ changedFiles, packageIds, affectedTests, impactedPaths, operation: input.operation });
  const evidence = summarizeEvidence(input.recentEvidence || [], integrity);
  const repeatCount = repeatFailureCount(input.recentEvidence || [], integrity.mutationGeneration || 0);
  const intent = inferIntent(input, changedFiles);
  const completion = normalizeCompletion(input.hardCompletion, integrity, changedFiles);
  const liveMatchingProcess = Boolean((input.processes || []).find(item => item?.reused === true || item?.matchesCurrent === true));
  const decision = decideWorkflow({ intent, boundary: classification.boundary, risk: classification.risk, completion, evidence, repeatCount, reviewFresh: input.reviewFresh, liveMatchingProcess });
  const snapshot = normalizeWorkflowSnapshot({
    version: 1,
    stage: decision.stage,
    intent,
    confidence: changedFiles.length || input.currentResult ? 'high' : 'medium',
    boundary: classification.boundary,
    risk: classification.risk,
    evidence,
    recommendedActions: decision.recommendedActions,
    avoidActions: decision.avoidActions,
    completion
  });
  snapshot.repeatCount = repeatCount;
  if (input.includeCatalog === true) snapshot.checkCatalog = buildCheckCatalog(topology).slice(0, 100);
  return snapshot;
}

function summarizeEvidence(receipts, integrity) {
  const mutation = Number(integrity.mutationGeneration || 0);
  let fresh = 0; let stale = 0; let reusable = 0;
  for (const receipt of receipts) {
    if (Number(receipt?.mutationGeneration || 0) === mutation) fresh += 1; else stale += 1;
    if (receipt?.kind === 'check' && receipt?.outcome === 'passed' && receipt?.repositoryFingerprint) reusable += 1;
  }
  return { fresh, stale, reusable, lastMutationGeneration: mutation, lastValidatedMutationGeneration: Number(integrity.latestValidatedMutationGeneration || 0) };
}
function inferIntent(input, changedFiles) {
  const explicit = String(input.intent || '').trim();
  if (explicit) return explicit;
  if (!changedFiles.length && input.currentResult) return 'investigation';
  if (changedFiles.length && changedFiles.every(file => /\.(md|txt|rst)$/i.test(file))) return 'documentation';
  return changedFiles.length ? 'bugfix' : 'auto';
}
function normalizeCompletion(explicit, integrity, changedFiles) {
  if (explicit && typeof explicit === 'object') return { hardReady: explicit.hardReady === true, blockers: unique(explicit.blockers || []), recommendations: unique(explicit.recommendations || []) };
  if (!changedFiles.length) return { hardReady: true, blockers: [], recommendations: [] };
  const currentValidation = integrity.validationResult === 'passed' && Number(integrity.latestValidatedMutationGeneration || 0) === Number(integrity.mutationGeneration || 0);
  return { hardReady: currentValidation, blockers: currentValidation ? [] : ['current mutation generation has no passed authoritative validation'], recommendations: [] };
}
function unique(values) { return [...new Set((Array.isArray(values) ? values : []).map(item => String(item || '').trim().replaceAll('\\', '/')).filter(Boolean))]; }

export { buildWorkflowSnapshot };