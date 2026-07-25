'use strict';

const MAX_CLIPBOARD_TEXT_BYTES = 64 * 1024;

function createWindowGuards(BrowserWindow, getSmokeWindowRole = () => '') {
  const isSenderWindow = (event, getWindow, smokeRole = '') => {
    const senderWindow = BrowserWindow.fromWebContents(event?.sender);
    if (senderWindow === getWindow()) return true;
    return Boolean(smokeRole && getSmokeWindowRole(senderWindow) === smokeRole);
  };
  const windowOnly = (event, getWindow, label, action, smokeRole = '') => {
    if (!isSenderWindow(event, getWindow, smokeRole)) throw new Error(`${label} is not available to this renderer.`);
    return action();
  };
  const allowedWindows = (event, getters, label, action, smokeRoles = []) => {
    if (!getters.some((getWindow, index) => isSenderWindow(event, getWindow, smokeRoles[index]))) {
      throw new Error(`${label} is not available to this renderer.`);
    }
    return action();
  };
  return { isSenderWindow, windowOnly, allowedWindows };
}

function isAllowedNgrokUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'dashboard.ngrok.com' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function logIpcFailure(error) {
  if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] secured IPC action:', error);
}

module.exports = { MAX_CLIPBOARD_TEXT_BYTES, createWindowGuards, isAllowedNgrokUrl, logIpcFailure };
