import { cancelAgent, createAgent, failAgentLaunch, getAgentStatus } from './manager.js';
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
    const connectorName = String(args.connectorName || this.connectorName).trim() || this.connectorName;
    const agent = createAgent(this.config, {
      ...args,
      role,
      reasoning,
      connectorName
    }, requestContext);
    try {
      const prompt = buildDelegatedAgentPrompt({
        agentId: agent.agent_id,
        connectorName,
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
        connectorName,
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
      const publicError = publicLaunchError(error, agent.agent_id);
      failAgentLaunch(this.config, {
        agent_id: agent.agent_id,
        error: publicError.message,
        errorCode: publicError.code
      }, requestContext);
      throw publicError;
    }
  }

  status(agentId, requestContext = {}) {
    return getAgentStatus(this.config, { agent_id: agentId }, requestContext);
  }

  async close(agentId) {
    const id = String(agentId || '').trim();
    const launch = this.launches.get(id);
    if (launch?.runtimeTaskId && typeof this.runtime.cancel === 'function') {
      await this.runtime.cancel(launch.runtimeTaskId).catch(() => {});
    }
    return this.launches.delete(id);
  }

  async cancel(agentId, requestContext = {}, reason = 'Parent cancelled delegated agent.') {
    const id = String(agentId || '').trim();
    await this.close(id);
    return cancelAgent(this.config, { agent_id: id, reason }, requestContext);
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

const SAFE_LAUNCH_ERRORS = Object.freeze({
  CHATGPT_LOGIN_REQUIRED: Object.freeze({ message: 'ChatGPT session is not authenticated. Open Settings > ChatGPT Subagents and sign in.', alternatives: ['Open Settings > ChatGPT Subagents and sign in, then retry relai_agent create.'] }),
  CHATGPT_AUTH_IN_PROGRESS: Object.freeze({ message: 'ChatGPT sign-in is still in progress.', alternatives: ['Finish or close the ChatGPT sign-in window, then retry relai_agent create.'] }),
  CHATGPT_AGENTS_ACTIVE: Object.freeze({ message: 'Active ChatGPT subagents must finish or be cancelled before authentication can change.', alternatives: ['Finish or cancel active delegated agents before changing ChatGPT authentication.'] }),
  CHATGPT_RUNTIME_UNAVAILABLE: Object.freeze({ message: 'No supported Chromium runtime is available for ChatGPT subagents.', alternatives: ['Install or configure a supported Chromium runtime, then retry relai_agent create.'] }),
  CHATGPT_TEMPORARY_MODE_REQUIRED: Object.freeze({ message: 'Rel.AI could not verify Temporary Chat, so the delegated prompt was not sent.', alternatives: ['Re-authenticate in Settings > ChatGPT Subagents and retry. If ChatGPT changed its Temporary Chat UI, update Rel.AI before retrying.'] }),
  CHATGPT_REASONING_PICKER_UNAVAILABLE: Object.freeze({ message: 'Rel.AI could not find the ChatGPT reasoning picker.', alternatives: ['Re-authenticate in Settings > ChatGPT Subagents and retry. If ChatGPT changed its reasoning picker, update Rel.AI before retrying.'] }),
  CHATGPT_REASONING_UNAVAILABLE: Object.freeze({ message: 'The requested ChatGPT reasoning level is not available for this account.', alternatives: ['Request a reasoning level currently shown in Settings > ChatGPT Subagents.'] }),
  CHATGPT_REASONING_SELECTION_FAILED: Object.freeze({ message: 'ChatGPT did not switch to the requested reasoning level.', alternatives: ['Request a reasoning level currently shown in Settings > ChatGPT Subagents, then retry.'] }),
  CHATGPT_COMPOSER_UNAVAILABLE: Object.freeze({ message: 'Rel.AI could not find the authenticated ChatGPT message composer.', alternatives: ['Re-authenticate in Settings > ChatGPT Subagents and retry. If ChatGPT changed its composer UI, update Rel.AI before retrying.'] }),
  CHATGPT_PROMPT_REQUIRED: Object.freeze({ message: 'The delegated ChatGPT prompt is empty.', alternatives: ['Retry relai_agent create with a non-empty delegated objective.'] })
});

function publicLaunchError(error, agentId) {
  const code = String(error?.code || '');
  const safe = SAFE_LAUNCH_ERRORS[code];
  const wrapped = new Error(safe ? safe.message : 'Agent runtime failed to start delegated agent.', error instanceof Error ? { cause: error } : undefined);
  wrapped.code = safe ? code : 'AGENT_RUNTIME_START_FAILED';
  wrapped.source = 'rel-ai-mcp';
  wrapped.operation = 'agent_launch';
  wrapped.agentId = String(agentId || '');
  wrapped.retryable = false;
  wrapped.requiresUserConfirmation = false;
  wrapped.allowedAlternatives = safe ? [...safe.alternatives] : ['Check Settings > ChatGPT Subagents for authentication/runtime status, then retry once the issue is resolved.'];
  return wrapped;
}

export { AgentOrchestrator };
