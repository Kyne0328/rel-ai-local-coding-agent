import * as crypto from 'node:crypto';

const WORKFLOW_STAGES = Object.freeze(['understand', 'investigate', 'design', 'implement', 'verify', 'review', 'repair', 'complete', 'blocked']);
const WORKFLOW_INTENTS = Object.freeze(['auto', 'investigation', 'bugfix', 'feature', 'refactor', 'migration', 'cleanup', 'documentation', 'performance', 'review', 'release', 'other']);
const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);
const BOUNDARY_LEVELS = Object.freeze(['file', 'package', 'cross_package', 'repository', 'release']);
const MAX_RECOMMENDED_ACTIONS = 5;
const MAX_WORKFLOW_BYTES = 8 * 1024;
const MAX_PATHS = 200;

function deterministicActionId(action = {}) {
  const tool = clean(action.tool) || 'workflow';
  const name = clean(action.action) || 'next';
  const digest = crypto.createHash('sha256').update(stableJson(action.args || {})).digest('hex').slice(0, 16);
  return `${tool}:${name}:${digest}`;
}

function normalizeWorkflowSnapshot(input = {}) {
  const boundaryInput = object(input.boundary);
  const riskInput = object(input.risk);
  const evidenceInput = object(input.evidence);
  const completionInput = object(input.completion);
  const normalized = {
    version: 1,
    stage: enumValue(input.stage, WORKFLOW_STAGES, 'understand'),
    intent: enumValue(input.intent, WORKFLOW_INTENTS, 'auto'),
    confidence: ['low', 'medium', 'high'].includes(clean(input.confidence)) ? clean(input.confidence) : 'medium',
    boundary: {
      level: enumValue(boundaryInput.level, BOUNDARY_LEVELS, 'file'),
      packageIds: strings(boundaryInput.packageIds, 50),
      changedFiles: strings(boundaryInput.changedFiles, MAX_PATHS),
      impactedPaths: strings(boundaryInput.impactedPaths, MAX_PATHS),
      affectedTests: strings(boundaryInput.affectedTests, MAX_PATHS)
    },
    risk: {
      level: enumValue(riskInput.level, RISK_LEVELS, 'low'),
      reasons: strings(riskInput.reasons, 20, 240)
    },
    evidence: {
      fresh: number(evidenceInput.fresh),
      stale: number(evidenceInput.stale),
      reusable: number(evidenceInput.reusable),
      lastMutationGeneration: number(evidenceInput.lastMutationGeneration),
      lastValidatedMutationGeneration: number(evidenceInput.lastValidatedMutationGeneration)
    },
    recommendedActions: actions(input.recommendedActions).slice(0, MAX_RECOMMENDED_ACTIONS),
    avoidActions: avoidActions(input.avoidActions).slice(0, 10),
    completion: {
      hardReady: completionInput.hardReady === true,
      blockers: strings(completionInput.blockers, 20, 300),
      recommendations: strings(completionInput.recommendations, 20, 300)
    }
  };
  return fitWorkflowBytes(normalized);
}

function actions(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value, index) => {
    const item = object(value);
    const args = safeArgs(item.args);
    const action = {
      priority: Math.max(1, Math.floor(Number(item.priority) || index + 1)),
      tool: clean(item.tool).slice(0, 100),
      action: clean(item.action).slice(0, 100),
      reason: clean(item.reason).slice(0, 500),
      blocking: item.blocking === true,
      estimatedCost: ['small', 'medium', 'large'].includes(clean(item.estimatedCost)) ? clean(item.estimatedCost) : 'small',
      args
    };
    return { id: clean(item.id).slice(0, 240) || deterministicActionId(action), ...action };
  }).filter(item => item.tool || item.action);
}

function avoidActions(values) {
  if (!Array.isArray(values)) return [];
  return values.map(value => ({
    action: clean(value?.action).slice(0, 200),
    reason: clean(value?.reason).slice(0, 500)
  })).filter(item => item.action || item.reason);
}

function safeArgs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = ['workspace', 'work_id', 'action', 'check', 'checks', 'command', 'cwd', 'path', 'paths', 'scope', 'processId'];
  return Object.fromEntries(allowed.filter(key => value[key] !== undefined).map(key => [key, sanitizeArg(value[key])]));
}

function sanitizeArg(value) {
  if (Array.isArray(value)) return value.slice(0, 20).map(item => clean(item).slice(0, 500));
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  return clean(value).slice(0, 1000);
}

function fitWorkflowBytes(value) {
  if (Buffer.byteLength(JSON.stringify(value)) <= MAX_WORKFLOW_BYTES) return value;
  const compact = structuredClone(value);
  compact.boundary.impactedPaths = [];
  compact.boundary.changedFiles = compact.boundary.changedFiles.slice(0, 50);
  compact.boundary.affectedTests = compact.boundary.affectedTests.slice(0, 50);
  compact.risk.reasons = compact.risk.reasons.slice(0, 5);
  compact.avoidActions = compact.avoidActions.slice(0, 5);
  compact.recommendedActions = compact.recommendedActions.map(item => ({ ...item, reason: item.reason.slice(0, 180), args: {} }));
  if (Buffer.byteLength(JSON.stringify(compact)) <= MAX_WORKFLOW_BYTES) return compact;
  compact.boundary.changedFiles = compact.boundary.changedFiles.slice(0, 10);
  compact.boundary.affectedTests = compact.boundary.affectedTests.slice(0, 10);
  compact.recommendedActions = compact.recommendedActions.slice(0, 3);
  return compact;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function strings(value, maxItems, maxLength = 500) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(clean).filter(Boolean))].slice(0, maxItems).map(item => item.slice(0, maxLength));
}
function enumValue(value, allowed, fallback) { const token = clean(value); return allowed.includes(token) ? token : fallback; }
function number(value) { const result = Number(value); return Number.isFinite(result) && result >= 0 ? Math.floor(result) : 0; }
function clean(value) { return String(value == null ? '' : value).trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

export { BOUNDARY_LEVELS, RISK_LEVELS, WORKFLOW_INTENTS, WORKFLOW_STAGES, deterministicActionId, normalizeWorkflowSnapshot, stableJson };