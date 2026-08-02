import { callTool } from '../tools.js';
import * as fs from "node:fs";
import * as path from "node:path";
import { readConfig } from "../config.js";
import { readJsonBody, sendJson } from "./io.js";

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

export { handleOpenFolder, handleWorkspaceChecks, handlePickFolder, workspacePathPreflight };
