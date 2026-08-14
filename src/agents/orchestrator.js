import { cancelAgent, createAgent, getAgentStatus } from './manager.js';
import { capabilitiesForRole, normalizeAgentRole, resolveReasoningLevel } from './contracts.js';
import { buildDelegatedAgentPrompt } from './prompt.js';

class AgentOrchestrator {
  constructor({ config, runtime, connectorName = 'Rel.AI MCP' } = {}) {
    if (!config || typeof config !== 'object') throw new Error('Agent orchestrator config is required.');
    if (!runtime || typeof runtime.getCapabilities !== 'function' || typeof runtime.spawn !== 'function') {
      throw new Error('Agent orchestrator requires an AgentRuntime-compatible runtime.');
    }
    this.config = config;
    this.runtime = runtime;
    this.connectorName = String(connectorName || '').trim();
    if (!this.connectorName) throw new Error('Agent connector name is required.');
    this.launches = new Map();
  }

  async spawn(args = {}, requestContext = {}) {
    const role = normalizeAgentRole(args.role || 'investigator');
    const runtimeCapabilities = await this.runtime.getCapabilities();
    const availableReasoning = Array.isArray(runtimeCapabilities?.reasoning) && runtimeCapabilities.reasoning.length
      ? runtimeCapabilities.reasoning
      : ['medium'];
    const reasoning = resolveReasoningLevel(args.reasoning || 'medium', availableReasoning);
    const capabilities = capabilitiesForRole(role);
    const agent = createAgent(this.config, {
      ...args,
      role,
      reasoning,
      connectorName: this.connectorName
    }, requestContext);
    try {
      const prompt = buildDelegatedAgentPrompt({
        agentId: agent.agent_id,
        connectorName: this.connectorName,
        workspace: agent.workspace,
        objective: agent.objective,
        role,
        reasoning,
        capabilities,
        context: args.context
      });
      const launch = await this.runtime.spawn({
        objective: agent.objective,
        role,
        reasoning,
        context: args.context || {}
      }, {
        agentId: agent.agent_id,
        parentWorkId: agent.parent_work_id,
        workspace: agent.workspace,
        connectorName: this.connectorName,
        prompt,
        capabilities
      });
      suppressDetachedPromise(launch?.resultPromise);
      const launchRecord = {
        runtime: String(this.runtime.name || runtimeCapabilities?.runtime || 'agent-runtime'),
        runtimeTaskId: String(launch?.runtimeTaskId || ''),
        reasoning: launch?.reasoning || reasoning
      };
      this.launches.set(agent.agent_id, launchRecord);
      return { agent, launch: { ...launchRecord } };
    } catch (error) {
      cancelAgent(this.config, {
        agent_id: agent.agent_id,
        reason: `Agent runtime failed to start: ${errorMessage(error)}`
      }, requestContext);
      const wrapped = new Error('Agent runtime failed to start delegated agent.', { cause: error });
      wrapped.code = 'AGENT_RUNTIME_START_FAILED';
      wrapped.agentId = agent.agent_id;
      throw wrapped;
    }
  }

  status(agentId, requestContext = {}) {
    return getAgentStatus(this.config, { agent_id: agentId }, requestContext);
  }

  async cancel(agentId, requestContext = {}, reason = 'Parent cancelled delegated agent.') {
    const id = String(agentId || '').trim();
    const launch = this.launches.get(id);
    if (launch?.runtimeTaskId && typeof this.runtime.cancel === 'function') {
      await this.runtime.cancel(launch.runtimeTaskId).catch(() => {});
    }
    this.launches.delete(id);
    return cancelAgent(this.config, { agent_id: id, reason }, requestContext);
  }

  release(agentId) {
    return this.launches.delete(String(agentId || '').trim());
  }

  getLaunch(agentId) {
    const launch = this.launches.get(String(agentId || '').trim());
    return launch ? { ...launch } : null;
  }

  async dispose() {
    this.launches.clear();
    if (typeof this.runtime.dispose === 'function') await this.runtime.dispose();
  }
}

function suppressDetachedPromise(value) {
  if (value && typeof value.catch === 'function') value.catch(() => {});
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'unknown runtime error');
}

export { AgentOrchestrator };
