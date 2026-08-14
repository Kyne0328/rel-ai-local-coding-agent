import { readConfig } from '../config.js';
import { getAgentService } from '../agents/agentService.js';
import { readJsonBody, sendJson } from './io.js';

function createChatGptAgentHandlers({ readConfigFn = readConfig, getAgentServiceFn = getAgentService } = {}) {
  return {
    handleChatGptAgentStatus: withService(async service => {
      const [auth, agents] = await Promise.all([
        service.authenticationStatus(),
        Promise.resolve(service.listForDashboard({ limit: 20 }))
      ]);
      return { ...auth, agents };
    }),
    handleChatGptAgentAuthOpen: withService(service => service.beginAuthentication()),
    handleChatGptAgentAuthFinish: withService(service => service.finishAuthentication()),
    handleChatGptAgentCancel: withService(async (service, ctx) => {
      const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
      const agentId = String(payload?.agent_id || '').trim();
      if (!agentId) throw dashboardAgentError('AGENT_ID_REQUIRED', 'Delegated agent id is required.');
      return service.cancelForDashboard({ agent_id: agentId, reason: 'Cancelled from Rel.AI desktop.' });
    })
  };

  function withService(operation) {
    return async ctx => {
      try {
        const service = await getAgentServiceFn(readConfigFn());
        const result = await operation(service, ctx);
        sendJson(ctx.res, 200, { ok: true, ...(result || {}) }, ctx.ae);
      } catch (error) {
        sendJson(ctx.res, 200, {
          ok: false,
          errorCode: String(error?.code || ''),
          error: error instanceof Error ? error.message : String(error || 'ChatGPT subagent operation failed.')
        }, ctx.ae);
      }
    };
  }
}

function dashboardAgentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const {
  handleChatGptAgentStatus,
  handleChatGptAgentAuthOpen,
  handleChatGptAgentAuthFinish,
  handleChatGptAgentCancel
} = createChatGptAgentHandlers();

export {
  createChatGptAgentHandlers,
  handleChatGptAgentStatus,
  handleChatGptAgentAuthOpen,
  handleChatGptAgentAuthFinish,
  handleChatGptAgentCancel
};
