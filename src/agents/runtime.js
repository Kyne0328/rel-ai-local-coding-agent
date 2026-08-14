import { normalizeAgentResult, normalizeAgentTaskInput, resolveReasoningLevel } from './contracts.js';

class AgentRuntime {
  constructor(name) {
    this.name = String(name || '').trim();
    if (!this.name) throw new Error('Agent runtime name is required.');
  }

  async getCapabilities() {
    throw new Error(`${this.name} must implement getCapabilities().`);
  }

  async spawn() {
    throw new Error(`${this.name} must implement spawn().`);
  }

  async cancel() {
    throw new Error(`${this.name} must implement cancel().`);
  }

  async dispose() {}
}

class FakeAgentRuntime extends AgentRuntime {
  constructor(options = {}) {
    super(options.name || 'fake');
    this.availableReasoning = options.availableReasoning || ['instant', 'medium', 'high'];
    this.handler = options.handler || (async task => ({ summary: `Completed: ${task.objective}` }));
    this.active = new Map();
    this.sequence = 0;
  }

  async getCapabilities() {
    return {
      runtime: this.name,
      reasoning: [...this.availableReasoning],
      temporaryChats: true,
      structuredCompletion: true
    };
  }

  async spawn(input, context = {}) {
    const task = normalizeAgentTaskInput(input);
    const reasoning = resolveReasoningLevel(task.reasoning, this.availableReasoning);
    const runtimeTaskId = `fake_agent_${++this.sequence}`;
    const record = { runtimeTaskId, task: { ...task, reasoning }, context, cancelled: false };
    this.active.set(runtimeTaskId, record);
    const resultPromise = Promise.resolve().then(async () => {
      if (record.cancelled) throw cancelledError();
      const value = await this.handler(record.task, context);
      if (record.cancelled) throw cancelledError();
      return normalizeAgentResult(value);
    }).finally(() => this.active.delete(runtimeTaskId));
    return { runtimeTaskId, reasoning, resultPromise };
  }

  async cancel(runtimeTaskId) {
    const record = this.active.get(String(runtimeTaskId || ''));
    if (!record) return { cancelled: false, alreadyTerminal: true };
    record.cancelled = true;
    return { cancelled: true, alreadyTerminal: false };
  }
}

function cancelledError() {
  const error = new Error('Agent task was cancelled.');
  error.code = 'AGENT_CANCELLED';
  return error;
}

export { AgentRuntime, FakeAgentRuntime };
