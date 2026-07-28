

import { readConfig } from "../config.js";
import { readJsonBody, sendJson } from "./io.js";
import { stopManagedProcess } from "../processManager.js";

async function handleApiProcessStop(ctx) {
  try {
    const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const processId = String(payload.processId || '').trim();
    if (!processId) throw new Error('processId is required.');
    const result = await stopManagedProcess(readConfig(), {
      processId,
      graceMs: Number(payload.graceMs || 3000)
    });
    sendJson(ctx.res, 200, result, ctx.ae);
  } catch (error) {
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) }, ctx.ae);
  }
}

export { handleApiProcessStop };
