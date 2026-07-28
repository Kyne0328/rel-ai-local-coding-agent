

import * as fs from "node:fs";
import * as path from "node:path";
import { sanitizeText } from "../src/diagnostics.js";

function createRuntimeLogBuffer({ maxEntries = 200, now = () => new Date().toISOString(), filePath = '' } = {}) {
  const entries = [];
  let hydratedPath = '';

  function append(message, options = {}) {
    hydrate();
    const entry = normalizeEntry({
      ts: options.ts || now(),
      level: options.level,
      source: options.source,
      code: options.code,
      message
    });
    if (!entry) return null;
    entries.push(entry);
    const overflow = entries.length > maxEntries;
    if (overflow) entries.splice(0, entries.length - maxEntries);
    persist(entry, overflow);
    return { ...entry };
  }

  function snapshot(options = {}) {
    hydrate();
    const limit = Math.min(Math.max(Number(options.limit || maxEntries), 1), maxEntries);
    return {
      available: true,
      count: entries.length,
      persistent: Boolean(resolveFilePath()),
      entries: entries.slice(-limit).map(entry => ({ ...entry }))
    };
  }

  function clear() {
    hydrate();
    const removed = entries.length;
    entries.length = 0;
    rewriteFile();
    return { ok: true, removed };
  }

  function recordStatusTransition(previous = {}, current = {}) {
    if (current.error && (current.error !== previous.error || current.errorCode !== previous.errorCode)) {
      append(current.error, { level: 'error', source: 'desktop', code: current.errorCode });
      return;
    }
    if (current.serverRunning && !previous.serverRunning) append('Local service started.', { source: 'local-service' });
    if (current.tunnelStatus === 'running' && previous.tunnelStatus !== 'running') append('Public endpoint is available.', { source: 'ngrok' });
    if (!current.serverRunning && previous.serverRunning) append('Local service stopped.', { source: 'local-service' });
  }

  function hydrate() {
    const target = resolveFilePath();
    if (!target || hydratedPath === target) return;
    hydratedPath = target;
    try {
      const lines = fs.readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean).slice(-maxEntries);
      for (const line of lines) {
        try {
          const entry = normalizeEntry(JSON.parse(line));
          if (entry) entries.push(entry);
        } catch {}
      }
      if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
    } catch (error) {
      if (error?.code !== 'ENOENT' && process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] runtime log hydrate:', error);
    }
  }

  function persist(entry, rewrite) {
    const target = resolveFilePath();
    if (!target) return;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      if (rewrite) rewriteFile();
      else fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] runtime log persist:', error);
    }
  }

  function rewriteFile() {
    const target = resolveFilePath();
    if (!target) return;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      const text = entries.map(entry => JSON.stringify(entry)).join('\n');
      fs.writeFileSync(target, text ? `${text}\n` : '', { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] runtime log rewrite:', error);
    }
  }

  function resolveFilePath() {
    try {
      return String(typeof filePath === 'function' ? filePath() : filePath || '').trim();
    } catch {
      return '';
    }
  }

  return { append, snapshot, clear, recordStatusTransition };
}

function normalizeEntry(value = {}) {
  const message = sanitizeText(value.message, 4000).trim();
  if (!message) return null;
  return {
    ts: value.ts || new Date().toISOString(),
    level: normalizeLevel(value.level),
    source: sanitizeText(value.source || 'desktop', 80),
    code: sanitizeText(value.code || '', 120),
    message
  };
}

function normalizeLevel(value) {
  if (value === 'error') return 'error';
  if (value === 'warning' || value === 'warn') return 'warning';
  return 'info';
}

export { createRuntimeLogBuffer };
