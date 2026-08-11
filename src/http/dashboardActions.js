import { callTool } from '../tools.js';
import * as fs from "node:fs";
import * as path from "node:path";
import { readConfig, writeConfig } from "../config.js";
import { readJsonBody, sendJson } from "./io.js";
import { installGitHubSkills, listSkillLibrary, previewGitHubSkills, removeInstalledSkill } from "../skillLibrary.js";


function skillsPayload(config) {
  const library = listSkillLibrary(config);
  const workspaces = Object.entries(config.workspaces || {})
    .map(([alias, workspace]) => ({
      alias,
      skills: normalizeSkillIds(workspace?.skills)
    }))
    .sort((left, right) => left.alias.localeCompare(right.alias));
  return { ok: true, ...library, workspaces };
}

async function applySkillsAction(config, payload = {}) {
  const action = String(payload.action || '').trim().toLowerCase();
  if (action === 'preview_github') {
    return previewGitHubSkills(config, payload.repositoryUrl);
  }
  if (action === 'install_github') {
    const result = await installGitHubSkills(config, payload.repositoryUrl, payload.selectedKeys);
    return { ...skillsPayload(config), installedNow: result.installed, missing: result.missing };
  }
  if (action === 'set_workspace_skills') {
    const alias = String(payload.workspace || '').trim();
    if (!alias || !config.workspaces?.[alias]) throw new Error(`Unknown workspace: ${alias || '(empty)'}`);
    const available = availableSkillIds(config);
    const skills = normalizeSkillIds(payload.skills);
    const unknown = skills.find(id => !available.has(id));
    if (unknown) throw new Error(`Unknown skill: ${unknown}`);
    const next = structuredClone(config);
    next.workspaces[alias].skills = skills;
    return skillsPayload(writeConfig(next));
  }
  if (action === 'remove_installed') {
    const skillId = String(payload.skillId || '').trim();
    if (!skillId) throw new Error('skillId is required');
    const removed = removeInstalledSkill(config, skillId);
    if (!removed.removed) return { ...skillsPayload(config), removed: false, skillId };
    const next = structuredClone(config);
    let changed = false;
    for (const workspace of Object.values(next.workspaces || {})) {
      const before = normalizeSkillIds(workspace.skills);
      const after = before.filter(id => id !== skillId);
      if (after.length !== before.length) changed = true;
      workspace.skills = after;
    }
    const current = changed ? writeConfig(next) : config;
    return { ...skillsPayload(current), removed: true, skillId };
  }
  throw new Error(`Unknown skills action: ${action || '(empty)'}`);
}

async function handleSkillsGet(ctx) {
  try {
    sendJson(ctx.res, 200, skillsPayload(readConfig()), ctx.ae);
  } catch (error) {
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) }, ctx.ae);
  }
}

async function handleSkillsPost(ctx) {
  try {
    const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
    sendJson(ctx.res, 200, await applySkillsAction(readConfig(), payload), ctx.ae);
  } catch (error) {
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) }, ctx.ae);
  }
}

function availableSkillIds(config) {
  const library = listSkillLibrary(config);
  return new Set([...library.builtIn, ...library.installed].map(skill => skill.id));
}

function normalizeSkillIds(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(list.map(item => String(item || '').trim()).filter(Boolean))];
}
async function handleOpenFolder(ctx) {
  if (typeof ctx.options.openFolder !== 'function') {
    sendJson(ctx.res, 200, { ok: false, unsupported: true, error: 'Opening folders is only available in the Rel.AI desktop app.' }, ctx.ae);
    return;
  }
  try {
    const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const config = readConfig();
    const workspace = config.workspaces?.[String(payload.workspace || '')];
    if (!workspace?.path) throw new Error(`Unknown workspace: ${payload.workspace || '(empty)'}`);
    const openedPath = await ctx.options.openFolder(workspace.path);
    sendJson(ctx.res, 200, { ok: true, workspace: payload.workspace, path: openedPath }, ctx.ae);
  } catch (error) {
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) }, ctx.ae);
  }
}

async function handleWorkspaceChecks(ctx) {
  let workId = '';
  try {
    const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const workspace = String(payload.workspace || '').trim();
    if (!workspace) throw new Error('workspace is required');
    const started = await callTool('relai_work', {
      action: 'begin',
      workspace,
      title: `Validate ${workspace}`,
      objective: 'Run the configured repository validation from the desktop dashboard.',
      bootstrap: 'none'
    }, { publicHttpOnly: false });
    workId = started.work_id;
    const result = await callTool('relai_validate', {
      action: 'checks',
      work_id: workId,
      complete: true,
      summary: `Dashboard validation completed for ${workspace}.`
    }, { publicHttpOnly: false });
    sendJson(ctx.res, 200, result, ctx.ae);
  } catch (error) {
    if (workId) {
      try {
        await callTool('relai_work', {
          action: 'cancel', work_id: workId, reason: 'Dashboard validation could not complete.'
        }, { publicHttpOnly: false });
      } catch {}
    }
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) }, ctx.ae);
  }
}

async function handlePickFolder(ctx) {
  if (typeof ctx.options.pickFolder !== 'function') {
    sendJson(ctx.res, 200, { ok: false, unsupported: true, error: 'Native folder picker is only available in the Rel.AI desktop launcher.' }, ctx.ae);
    return;
  }
  try {
    const picked = await ctx.options.pickFolder();
    if (!picked) {
      sendJson(ctx.res, 200, { ok: false, canceled: true }, ctx.ae);
      return;
    }
    sendJson(ctx.res, 200, { ok: true, ...workspacePathPreflight(picked) }, ctx.ae);
  } catch (error) {
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) }, ctx.ae);
  }
}

function workspacePathPreflight(rawPath) {
  const target = path.resolve(String(rawPath || ''));
  const findings = [];
  let stat = null;
  try {
    stat = fs.statSync(target);
  } catch {
    findings.push({ severity: 'error', code: 'path_not_found', message: `Path does not exist: ${target}` });
  }
  const exists = Boolean(stat);
  const isDirectory = Boolean(stat?.isDirectory());
  const isGit = isDirectory && fs.existsSync(path.join(target, '.git'));
  if (exists && !isDirectory) findings.push({ severity: 'error', code: 'path_not_directory', message: `Path is not a directory: ${target}` });
  return {
    ok: findings.every(item => item.severity !== 'error'),
    path: target,
    exists,
    isDirectory,
    isGit,
    findings
  };
}

export { applySkillsAction, handleOpenFolder, handlePickFolder, handleSkillsGet, handleSkillsPost, handleWorkspaceChecks, skillsPayload, workspacePathPreflight };


