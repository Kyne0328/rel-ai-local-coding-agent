import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

class ChromiumRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ChromiumRuntimeError';
    this.code = code;
  }
}

function resolveChromiumRuntime(options = {}) {
  const override = String(options.override || '').trim();
  if (override) {
    if (!isExecutableFile(override)) {
      throw new ChromiumRuntimeError(
        'CHROMIUM_RUNTIME_OVERRIDE_INVALID',
        'Configured Chromium path does not point to an available file.'
      );
    }
    return { executablePath: override, product: 'configured Chromium' };
  }

  for (const candidate of chromiumCandidates(options)) {
    if (isExecutableFile(candidate.executablePath)) return candidate;
  }
  throw new ChromiumRuntimeError(
    'CHROMIUM_RUNTIME_UNAVAILABLE',
    'No supported local Chromium runtime was found. Install Chrome, Edge, or Chromium.'
  );
}

function chromiumCandidates(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const candidates = [];
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      candidates.push({ executablePath: path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), product: 'Microsoft Edge' });
      candidates.push({ executablePath: path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), product: 'Google Chrome' });
      candidates.push({ executablePath: path.join(root, 'Chromium', 'Application', 'chrome.exe'), product: 'Chromium' });
    }
  } else if (platform === 'darwin') {
    candidates.push(
      { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', product: 'Google Chrome' },
      { executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', product: 'Microsoft Edge' },
      { executablePath: '/Applications/Chromium.app/Contents/MacOS/Chromium', product: 'Chromium' }
    );
  } else {
    for (const [name, product] of [
      ['google-chrome', 'Google Chrome'],
      ['google-chrome-stable', 'Google Chrome'],
      ['microsoft-edge', 'Microsoft Edge'],
      ['microsoft-edge-stable', 'Microsoft Edge'],
      ['chromium', 'Chromium'],
      ['chromium-browser', 'Chromium']
    ]) {
      const resolved = spawnSync('which', [name], { encoding: 'utf8', windowsHide: true });
      const executablePath = String(resolved.stdout || '').trim().split(/\r?\n/, 1)[0];
      if (executablePath) candidates.push({ executablePath, product });
    }
  }
  try {
    const bundled = options.bundledExecutablePath === undefined
      ? chromium.executablePath()
      : options.bundledExecutablePath;
    if (bundled) candidates.push({ executablePath: bundled, product: 'Chromium' });
  } catch {}
  return candidates;
}

function isExecutableFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

export { ChromiumRuntimeError, chromiumCandidates, resolveChromiumRuntime };
