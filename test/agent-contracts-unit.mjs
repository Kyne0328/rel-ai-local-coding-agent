import assert from 'node:assert/strict';

import {
  capabilitiesForRole,
  normalizeAgentResult,
  normalizeAgentTaskInput,
  resolveReasoningLevel
} from '../src/agents/contracts.js';
import { AgentRuntime, FakeAgentRuntime } from '../src/agents/runtime.js';

assert.deepEqual(capabilitiesForRole('investigator'), ['search', 'read', 'status', 'complete', 'fail']);
assert.equal(capabilitiesForRole('investigator').includes('edit'), false);
assert.equal(capabilitiesForRole('implementer').includes('edit'), true);
assert.equal(resolveReasoningLevel('pro', ['instant', 'medium', 'high']), 'high');
assert.equal(resolveReasoningLevel('high', ['medium', 'high', 'extra_high']), 'high');
assert.throws(() => normalizeAgentTaskInput({ objective: '' }), /objective/i);
assert.throws(() => normalizeAgentTaskInput({ objective: 'x', role: 'root' }), /role/i);

const task = normalizeAgentTaskInput({
  objective: 'Inspect the connection lifecycle.',
  role: 'reviewer',
  reasoning: 'high',
  context: { files: ['src/example.js'] }
});
assert.equal(task.role, 'reviewer');
assert.equal(task.capabilities.includes('edit'), false);
assert.equal(task.reasoning, 'high');

const bounded = normalizeAgentResult({
  summary: 'Done',
  findings: ['A'],
  evidence: ['B'],
  files: ['src/example.js'],
  recommendations: ['C'],
  risks: ['D']
});
assert.deepEqual(bounded.findings, ['A']);

const runtime = new FakeAgentRuntime({
  availableReasoning: ['instant', 'medium', 'high'],
  handler: async input => ({
    summary: `${input.role}:${input.reasoning}`,
    findings: ['deterministic']
  })
});
const capabilities = await runtime.getCapabilities();
assert.deepEqual(capabilities.reasoning, ['instant', 'medium', 'high']);
const spawned = await runtime.spawn({ objective: 'Review code.', role: 'reviewer', reasoning: 'pro' });
assert.equal(spawned.reasoning, 'high');
assert.deepEqual(await spawned.resultPromise, {
  summary: 'reviewer:high',
  findings: ['deterministic'],
  evidence: [],
  files: [],
  recommendations: [],
  risks: []
});

const incomplete = new AgentRuntime('base');
await assert.rejects(() => incomplete.spawn({}), /implement spawn/);

console.log('Agent contracts, capability policy, reasoning fallback, and fake runtime tests passed.');
