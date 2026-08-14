import * as path from 'node:path';
import { getStateDir } from '../statePaths.js';
import { attachAgent, completeAgent, failAgent, failAgentLaunch, getAgentStatus, reconcileOrphanedAgents } from './manager.js';
import { AgentOrchestrator } from './orchestrator.js';

const servicePromises = new Map();
const DEFAULT_AGENT_ATTACH_TIMEOUT_MS = 120_000;
const ATTACH_TIMEOUT_CODE = 'AGENT_ATTACH_TIMEOUT';
const MAX_AGENT_STATUS_WAIT_MS = 60_000;
const AGENT_STATUS_POLL_MS = 250;
const WAITABLE_AGENT_STATES = new Set(['pending', 'starting', 'working', 'input_required']);

class AgentService {
  constructor({ config, runtime, connectorName = 'Rel.AI MCP', attachTimeoutMs = DEFAULT_AGENT_ATTACH_TIMEOUT_MS } = {}) {
    if (!config || typeof config !== 'object') throw new Error('Agent service config is required.');
    if (!runtime) throw new Error('Agent service runtime is required.');
    this.config = config;
    this.runtime = runtime;
    this.attachTimeoutMs = normalizeAttachTimeout(attachTimeoutMs);
    this.pendingAttachTimers = new Map();
    this.orchestrator = new AgentOrchestrator({ config, runtime, connectorName });
  }

  async create(args = {}, context = {}) {
    const { agent } = await this.orchestrator.spawn(args, context);
    this.scheduleAttachTimeout(agent.agent_id, context);
    return agent;
  }

  attach(args = {}, context = {}) {
    const agent = attachAgent(this.config, args, context);
    this.clearAttachTimeout(agent.agent_id);
    return agent;
  }

  async status(args = {}, context = {}) {
    const waitMs = normalizeStatusWait(args.waitMs);
    let status = getAgentStatus(this.config, args, context);
    if (!waitMs || !WAITABLE_AGENT_STATES.has(status.status)) return status;
    const deadline = Date.now() + waitMs;
    while (WAITABLE_AGENT_STATES.has(status.status)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(AGENT_STATUS_POLL_MS, remaining));
      status = getAgentStatus(this.config, args, context);
    }
    return status;
  }

  async complete(args = {}, context = {}) {
    const agent = completeAgent(this.config, args, context);
    this.clearAttachTimeout(agent.agent_id);
    await this.orchestrator.close(agent.agent_id);
    return agent;
  }

  async fail(args = {}, context = {}) {
    const agent = failAgent(this.config, args, context);
    this.clearAttachTimeout(agent.agent_id);
    await this.orchestrator.close(agent.agent_id);
    return agent;
  }

  async cancel(args = {}, context = {}) {
    this.clearAttachTimeout(args.agent_id);
    return this.orchestrator.cancel(args.agent_id, context, args.reason);
  }

  async authenticationStatus() {
    const auth = typeof this.runtime.authenticationStatus === 'function'
      ? this.runtime.authenticationStatus()
      : { runtime: String(this.runtime.name || 'agent-runtime'), status: 'unsupported', authenticatedAt: null };
    return { ...auth, reasoning: Array.isArray(auth?.reasoning) ? [...auth.reasoning] : [] };
  }

  async beginAuthentication() {
    if (typeof this.runtime.beginAuthentication !== 'function') throw unsupportedAuthentication();
    return this.runtime.beginAuthentication();
  }

  async finishAuthentication() {
    if (typeof this.runtime.finishAuthentication !== 'function') throw unsupportedAuthentication();
    return this.runtime.finishAuthentication();
  }

  scheduleAttachTimeout(agentId, context) {
    const id = String(agentId || '').trim();
    this.clearAttachTimeout(id);
    const timer = setTimeout(() => {
      void this.expireUnattachedAgent(id, context).catch(() => {});
    }, this.attachTimeoutMs);
    timer.unref?.();
    this.pendingAttachTimers.set(id, timer);
  }

  clearAttachTimeout(agentId) {
    const id = String(agentId || '').trim();
    const timer = this.pendingAttachTimers.get(id);
    if (!timer) return false;
    clearTimeout(timer);
    this.pendingAttachTimers.delete(id);
    return true;
  }

  async expireUnattachedAgent(agentId, context) {
    this.pendingAttachTimers.delete(agentId);
    const seconds = Math.ceil(this.attachTimeoutMs / 1000);
    let timedOut;
    try {
      timedOut = failAgentLaunch(this.config, {
        agent_id: agentId,
        errorCode: ATTACH_TIMEOUT_CODE,
        error: `Delegated ChatGPT agent did not attach to Rel.AI MCP within ${seconds} seconds. The connector may be unavailable in the spawned chat; confirm Rel.AI MCP is enabled in ChatGPT and retry.`
      }, context);
    } catch {
      await this.orchestrator.close(agentId);
      return;
    }
    if (timedOut.status === 'failed' && timedOut.errorCode === ATTACH_TIMEOUT_CODE) {
      await this.orchestrator.close(agentId);
    }
  }

  async dispose() {
    for (const timer of this.pendingAttachTimers.values()) clearTimeout(timer);
    this.pendingAttachTimers.clear();
    await this.orchestrator.dispose();
  }
}

async function getAgentService(config) {
  const key = serviceKey(config);
  let servicePromise = servicePromises.get(key);
  if (!servicePromise) {
    servicePromise = createDefaultService(config);
    servicePromises.set(key, servicePromise);
    servicePromise.catch(() => servicePromises.delete(key));
  }
  return servicePromise;
}

async function createDefaultService(config) {
  reconcileOrphanedAgents(config);
  const { ChatGptWebRuntime } = await import('./chatgptWebRuntime.js');
  return new AgentService({ config, runtime: new ChatGptWebRuntime({ config }) });
}

async function disposeAgentServices(config) {
  if (config) {
    const key = serviceKey(config);
    const servicePromise = servicePromises.get(key);
    servicePromises.delete(key);
    const service = servicePromise ? await servicePromise.catch(() => null) : null;
    if (service) await service.dispose().catch(() => {});
    return;
  }
  const active = [...servicePromises.values()];
  servicePromises.clear();
  const services = await Promise.all(active.map(promise => promise.catch(() => null)));
  await Promise.allSettled(services.filter(Boolean).map(service => service.dispose()));
}

function serviceKey(config) {
  return path.resolve(getStateDir(config));
}

function normalizeAttachTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Agent attach timeout must be a positive number.');
  return Math.floor(timeout);
}

function normalizeStatusWait(value) {
  if (value == null) return 0;
  const waitMs = Number(value);
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > MAX_AGENT_STATUS_WAIT_MS) {
    throw new Error(`Agent status waitMs must be an integer between 0 and ${MAX_AGENT_STATUS_WAIT_MS}.`);
  }
  return waitMs;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function unsupportedAuthentication() {
  const error = new Error('This agent runtime does not support interactive authentication.');
  error.code = 'AGENT_AUTH_UNSUPPORTED';
  return error;
}

export {
  AgentService,
  ATTACH_TIMEOUT_CODE,
  DEFAULT_AGENT_ATTACH_TIMEOUT_MS,
  MAX_AGENT_STATUS_WAIT_MS,
  disposeAgentServices,
  getAgentService
};
