import { readConfig, writeConfig } from '../config.js';
import { addKnowledgeItem, clearKnowledge, deleteKnowledgeItem, knowledgeSummary, listKnowledge } from '../knowledgeStore.js';
import { clearManagedSkills, deleteManagedSkill, listManagedSkills } from '../skillManager.js';
import { readJsonBody, sendJson } from './io.js';

function handleApiKnowledge(ctx) {
  const config = readConfig();
  const managedSkills = listManagedSkills(config);
  sendJson(ctx.res, 200, {
    ok: true,
    ...knowledgeSummary(config),
    learnedSkillCount: managedSkills.length,
    items: listKnowledge(config, { limit: 200 }),
    managedSkills
  });
}

async function handleApiKnowledgeAction(ctx) {
  try {
    const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const action = String(payload.action || '').trim().toLowerCase();
    let config = readConfig();
    let result;
    if (action === 'settings') {
      const next = structuredClone(config);
      next.knowledge = {
        ...(next.knowledge && typeof next.knowledge === 'object' ? next.knowledge : {}),
        ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {}),
        ...(typeof payload.proceduralLearning === 'boolean' ? { proceduralLearning: payload.proceduralLearning } : {})
      };
      config = writeConfig(next);
      result = { ok: true, settings: knowledgeSummary(config).settings };
    } else if (action === 'add') {
      result = { ok: true, item: addKnowledgeItem(config, payload) };
    } else if (action === 'delete') {
      result = deleteKnowledgeItem(config, payload.id);
    } else if (action === 'delete_skill') {
      result = deleteManagedSkill(config, { name: payload.name, scope: payload.scope, workspace: payload.workspace });
    } else if (action === 'clear') {
      if (payload.confirm !== true) throw new Error('Clearing knowledge requires confirm=true.');
      result = { ...clearKnowledge(config), ...clearManagedSkills(config) };
    } else {
      throw new Error('Unknown knowledge action.');
    }
    sendJson(ctx.res, 200, { ...result, summary: knowledgeSummary(config) });
  } catch (error) {
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

export { handleApiKnowledge, handleApiKnowledgeAction };
