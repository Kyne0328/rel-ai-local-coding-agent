import { readConfig, writeConfig } from '../config.js';
import { computerControlSettings, readComputerStatus } from '../computerManager.js';
import { readJsonBody, sendJson } from './io.js';

async function handleApiComputer(ctx) {
  const config = readConfig();
  sendJson(ctx.res, 200, {
    ok: true,
    settings: computerControlSettings(config),
    status: await readComputerStatus(config)
  });
}

async function handleApiComputerAction(ctx) {
  try {
    const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
    if (typeof payload.enabled !== 'boolean') throw new Error('Computer control enabled must be a boolean.');
    const current = readConfig();
    const next = structuredClone(current);
    next.computerControl = { enabled: payload.enabled };
    const config = writeConfig(next);
    sendJson(ctx.res, 200, {
      ok: true,
      settings: computerControlSettings(config),
      status: await readComputerStatus(config)
    });
  } catch (error) {
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

export { handleApiComputer, handleApiComputerAction };
