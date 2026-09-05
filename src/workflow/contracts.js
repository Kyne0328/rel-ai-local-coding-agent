import * as crypto from 'node:crypto';

const WORKFLOW_INTENTS = Object.freeze(['auto', 'investigation', 'bugfix', 'feature', 'refactor', 'migration', 'cleanup', 'documentation', 'performance', 'review', 'release', 'other']);

function deterministicActionId(action = {}) {
  const tool = String(action.tool || 'action');
  const name = String(action.action || 'run');
  const digest = crypto.createHash('sha256').update(stableJson(action.args || {})).digest('hex').slice(0, 16);
  return `${tool}:${name}:${digest}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export { WORKFLOW_INTENTS, deterministicActionId, stableJson };
