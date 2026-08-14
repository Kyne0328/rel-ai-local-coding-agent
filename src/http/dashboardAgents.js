import { readConfig } from '../config.js';
import { getAgentService } from '../agents/agentService.js';
import { sendJson } from './io.js';
function createChatGptAgentHandlers({ readConfigFn = readConfig, getAgentServiceFn = getAgentService } = {}) {
  return {
    handleChatGptAgentStatus: withService(service => service.authenticationStatus()),
    handleChatGptAgentAuthOpen: withService(service => service.beginAuthentication()),
    handleChatGptAgentAuthFinish: withService(service => service.finishAuthentication())
  };
  function withService(operation) {
    return async ctx => {
      try {
        const service = await getAgentServiceFn(readConfigFn());
        const result = await operation(service);
        sendJson(ctx.res, 200, { ok: true, ...(result || {}) }, ctx.ae);
      } catch (error) {
        sendJson(ctx.res, 200, {
          ok: false,
          errorCode: String(error?.code || ''),
          error: error instanceof Error ? error.message : String(error || 'ChatGPT subagent authentication failed.')
        }, ctx.ae);
      }
    };
  }
}
const { handleChatGptAgentStatus, handleChatGptAgentAuthOpen, handleChatGptAgentAuthFinish } = createChatGptAgentHandlers();
export { createChatGptAgentHandlers, handleChatGptAgentStatus, handleChatGptAgentAuthOpen, handleChatGptAgentAuthFinish };
