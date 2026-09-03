import { knowledgeSettings, searchKnowledge, searchVerifiedProcedures } from '../knowledgeStore.js';
import { readConversationContinuity, readCrossWorkspaceTaskEpisodes } from '../taskHistoryStore.js';

function buildTaskContinuity(config, options = {}) {
  const settings = knowledgeSettings(config);
  if (!settings.enabled) return {};
  const query = String(options.query || '').trim();
  if (!query) return {};
  const workspace = String(options.workspace || '').trim();
  const excludeTaskId = String(options.excludeTaskId || '').trim();
  const conversationId = String(options.conversationId || '').trim();
  const groups = [
    ['relevantKnowledge', safeList(() => searchKnowledge(config, query, { workspace, limit: 3, maxBytes: settings.maxBootstrapBytes }))],
    ['suggestedProcedures', safeList(() => searchVerifiedProcedures(config, query, { limit: 3, maxBytes: settings.maxBootstrapBytes }))],
    ['conversationContinuity', conversationId ? safeList(() => readConversationContinuity(config, conversationId, { excludeTaskId, limit: 3 })) : []],
    ['crossWorkspaceTasks', safeList(() => readCrossWorkspaceTaskEpisodes(config, workspace, query, { excludeTaskId, limit: 2 }))]
  ];
  const result = {};
  for (const [key, values] of groups) {
    if (!values.length) continue;
    const accepted = [];
    for (const value of values) {
      if (!value) continue;
      accepted.push(value);
      result[key] = accepted;
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= settings.maxBootstrapBytes) continue;
      accepted.pop();
      if (!accepted.length) delete result[key];
      break;
    }
  }
  return result;
}

function safeList(read) {
  try {
    const value = read();
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] task continuity:', error);
    return [];
  }
}

export { buildTaskContinuity };
