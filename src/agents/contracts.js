const AGENT_ROLES = Object.freeze(['investigator', 'reviewer', 'planner', 'verifier', 'implementer']);
const AGENT_STATES = Object.freeze(['pending', 'starting', 'working', 'input_required', 'completed', 'failed', 'cancelled']);
const REASONING_LEVELS = Object.freeze(['instant', 'medium', 'high', 'extra_high', 'pro']);

const ROLE_CAPABILITIES = Object.freeze({
  investigator: Object.freeze(['search', 'read', 'status', 'complete', 'fail']),
  reviewer: Object.freeze(['search', 'read', 'review', 'validate', 'status', 'complete', 'fail']),
  planner: Object.freeze(['search', 'read', 'status', 'complete', 'fail']),
  verifier: Object.freeze(['read', 'exec', 'validate', 'status', 'complete', 'fail']),
  implementer: Object.freeze(['search', 'read', 'edit', 'exec', 'validate', 'status', 'complete', 'fail'])
});

function normalizeAgentRole(value = 'investigator') {
  const role = String(value || '').trim().toLowerCase();
  if (!AGENT_ROLES.includes(role)) throw new Error(`Unsupported agent role '${role || '(missing)'}.`);
  return role;
}

function normalizeAgentState(value = 'pending') {
  const state = String(value || '').trim().toLowerCase();
  if (!AGENT_STATES.includes(state)) throw new Error(`Unsupported agent state '${state || '(missing)'}.`);
  return state;
}

function normalizeReasoningLevel(value = 'medium') {
  const reasoning = String(value || '').trim().toLowerCase().replaceAll('-', '_');
  if (!REASONING_LEVELS.includes(reasoning)) throw new Error(`Unsupported agent reasoning level '${reasoning || '(missing)'}.`);
  return reasoning;
}

function capabilitiesForRole(role) {
  return [...ROLE_CAPABILITIES[normalizeAgentRole(role)]];
}

function resolveReasoningLevel(requested, available = REASONING_LEVELS) {
  const normalizedAvailable = [...new Set((available || []).map(normalizeReasoningLevel))];
  if (!normalizedAvailable.length) throw new Error('Agent runtime exposes no reasoning levels.');
  const desired = normalizeReasoningLevel(requested || 'medium');
  const desiredIndex = REASONING_LEVELS.indexOf(desired);
  for (let index = desiredIndex; index >= 0; index -= 1) {
    if (normalizedAvailable.includes(REASONING_LEVELS[index])) return REASONING_LEVELS[index];
  }
  return normalizedAvailable[0];
}

function normalizeAgentResult(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent result must be an object.');
  const findings = normalizeStringArray(value.findings, 100);
  const evidence = normalizeStringArray(value.evidence, 100);
  const files = normalizeStringArray(value.files, 200);
  const recommendations = normalizeStringArray(value.recommendations, 100);
  const risks = normalizeStringArray(value.risks, 100);
  return {
    summary: boundedText(value.summary, 12_000),
    findings,
    evidence,
    files,
    recommendations,
    risks
  };
}

function normalizeAgentTaskInput(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent task input must be an object.');
  const objective = boundedText(value.objective, 20_000);
  if (!objective) throw new Error('Agent objective is required.');
  const role = normalizeAgentRole(value.role || 'investigator');
  return {
    objective,
    role,
    reasoning: normalizeReasoningLevel(value.reasoning || 'medium'),
    capabilities: capabilitiesForRole(role),
    context: normalizeContext(value.context)
  };
}

function normalizeContext(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent context must be an object.');
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) throw new Error('Agent context exceeds 256 KiB.');
  return JSON.parse(serialized);
}

function normalizeStringArray(value, maxItems) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Agent result list fields must be arrays.');
  return value.slice(0, maxItems).map(item => boundedText(item, 4000)).filter(Boolean);
}

function boundedText(value, maxChars) {
  const text = String(value ?? '').trim();
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

export {
  AGENT_ROLES,
  AGENT_STATES,
  REASONING_LEVELS,
  ROLE_CAPABILITIES,
  capabilitiesForRole,
  normalizeAgentResult,
  normalizeAgentRole,
  normalizeAgentState,
  normalizeAgentTaskInput,
  normalizeReasoningLevel,
  resolveReasoningLevel
};
