import { readConfig, writeConfig } from '../config.js';
import { clearLearningState, ensureLearningState, knowledgeSettings } from '../knowledgeStore.js';
import { clearManagedSkills, deleteManagedSkill, listManagedSkills } from '../skillManager.js';
import { readJsonBody, sendJson } from './io.js';

function learningSummary(config) {
  ensureLearningState(config);
  const managedSkills = listManagedSkills(config);
  return {
    settings: knowledgeSettings(config),
    learnedSkillCount: managedSkills.length,
    managedSkills
  };
}

function handleApiLearning(ctx) {
  const config = readConfig();
  sendJson(ctx.res, 200, { ok: true, ...learningSummary(config) });
}

async function handleApiLearningAction(ctx) {
  try {
    const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const action = String(payload.action || '').trim().toLowerCase();
    let config = readConfig();
    let result;
    if (action === 'settings') {
      const next = structuredClone(config);
      next.knowledge = {
        ...(next.knowledge && typeof next.knowledge === 'object' ? next.knowledge : {}),
        ...(typeof payload.proceduralLearning === 'boolean' ? { proceduralLearning: payload.proceduralLearning } : {})
      };
      config = writeConfig(next);
      result = { ok: true, settings: knowledgeSettings(config) };
    } else if (action === 'delete_skill') {
      result = deleteManagedSkill(config, { name: payload.name, scope: payload.scope, workspace: payload.workspace });
    } else if (action === 'clear') {
      if (payload.confirm !== true) throw new Error('Clearing learned data requires confirm=true.');
      result = { ...clearLearningState(config), ...clearManagedSkills(config) };
    } else {
      throw new Error('Unknown learning action.');
    }
    sendJson(ctx.res, 200, { ...result, summary: learningSummary(config) });
  } catch (error) {
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

export { handleApiLearning, handleApiLearningAction };
