import * as path from 'node:path';
import { getStateDir } from '../statePaths.js';
import { attachAgent, completeAgent, failAgent, getAgentStatus } from './manager.js';
import { AgentOrchestrator } from './orchestrator.js';
const servicePromises = new Map();
class AgentService {
  constructor({ config, runtime, connectorName = 'Rel.AI MCP' } = {}) {
    if (!config || typeof config !== 'object') throw new Error('Agent service config is required.');
    if (!runtime) throw new Error('Agent service runtime is required.');
    this.config = config;
    this.orchestrator = new AgentOrchestrator({ config, runtime, connectorName });
  }
  async create(args = {}, context = {}) {
    const { agent } = await this.orchestrator.spawn(args, context);
    return agent;
  }
  attach(args = {}, context = {}) {
    return attachAgent(this.config, args, context);
  }
  status(args = {}, context = {}) {
    return getAgentStatus(this.config, args, context);
  }
  async complete(args = {}, context = {}) {
    const agent = completeAgent(this.config, args, context);
    await this.orchestrator.close(agent.agent_id);
    return agent;
  }
  async fail(args = {}, context = {}) {
    const agent = failAgent(this.config, args, context);
    await this.orchestrator.close(agent.agent_id);
    return agent;
  }
  cancel(args = {}, context = {}) {
    return this.orchestrator.cancel(args.agent_id, context, args.reason);
  }
  dispose() {
    return this.orchestrator.dispose();
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
export { AgentService, disposeAgentServices, getAgentService };