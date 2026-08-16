

import * as fs from "node:fs";
import * as path from "node:path";
import { sanitizeText } from "../src/diagnostics.js";

function createRuntimeLogBuffer({ maxEntries = 200, now = () => new Date().toISOString(), filePath = '' } = {}) {
  const entryLimit = Math.max(1, Math.floor(Number(maxEntries) || 200));
  const compactAfterEntries = entryLimit * 2;
  const entries = [];
  const listeners = new Set();
  let hydratedPath = '';
  let persistedEntries = 0;
  let preparedDirectory = '';
  let writeQueue = Promise.resolve();
  let revision = 0;

  function append(message, options = {}) {
    hydrate();
    const entry = normalizeEntry({
      ...options,
      ts: options.ts || now(),
      message
    });
    if (!entry) return null;
    entries.push(entry);
    if (entries.length > entryLimit) entries.splice(0, entries.length - entryLimit);
    persist(entry);
    revision += 1;
    emit({ type: 'append', revision, count: entries.length, maxEntries: entryLimit, entry: { ...entry } });
    return { ...entry };
  }

  function snapshot(options = {}) {
    hydrate();
    const limit = Math.min(Math.max(Number(options.limit || entryLimit), 1), entryLimit);
    return {
      available: true,
      revision,
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
    revision += 1;
    emit({ type: 'reset', revision, count: 0, maxEntries: entryLimit, removed });
    return { ok: true, removed };
  }

  function recordStatusTransition(previous = {}, current = {}) {
    if (current.error && (current.error !== previous.error || current.errorCode !== previous.errorCode)) {
      append(current.error, { level: 'error', source: 'desktop', code: current.errorCode });
      return;
    }
    if (current.serverRunning && !previous.serverRunning) append('Local service started.', { source: 'local-service' });
    if (current.tunnelStatus === 'running' && previous.tunnelStatus !== 'running') append('OpenAI Secure MCP Tunnel is connected.', { source: 'openai-tunnel' });
    if (!current.serverRunning && previous.serverRunning) append('Local service stopped.', { source: 'local-service' });
  }

  function hydrate() {
    const target = resolveFilePath();
    if (!target || hydratedPath === target) return;
    hydratedPath = target;
    entries.length = 0;
    persistedEntries = 0;
    try {
      const persistedLines = fs.readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean);
      persistedEntries = persistedLines.length;
      const lines = persistedLines.slice(-entryLimit);
      for (const line of lines) {
        try {
          const entry = normalizeEntry(JSON.parse(line));
          if (entry) entries.push(entry);
        } catch {}
      }
      if (persistedEntries > compactAfterEntries) rewriteFile();
    } catch (error) {
      if (error?.code !== 'ENOENT' && process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] runtime log hydrate:', error);
    }
  }

  function persist(entry) {
    const target = resolveFilePath();
    if (!target) return;
    persistedEntries += 1;
    if (persistedEntries > compactAfterEntries) {
      rewriteFile();
      return;
    }
    enqueueWrite(target, () => fs.promises.appendFile(target, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 }));
  }

  function rewriteFile() {
    const target = resolveFilePath();
    if (!target) return;
    persistedEntries = entries.length;
    const text = entries.map(entry => JSON.stringify(entry)).join('\n');
    enqueueWrite(target, () => fs.promises.writeFile(target, text ? `${text}\n` : '', { encoding: 'utf8', mode: 0o600 }));
  }

  function enqueueWrite(target, operation) {
    writeQueue = writeQueue.then(async () => {
      const directory = path.dirname(target);
      if (preparedDirectory !== directory) {
        await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
        preparedDirectory = directory;
      }
      await operation();
    }).catch(error => {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] runtime log persist:', error);
    });
  }

  async function flush() {
    await writeQueue;
  }

  function onChange(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function emit(event) {
    for (const listener of [...listeners]) {
      try { listener(event); } catch {}
    }
  }

  function resolveFilePath() {
    try {
      return String(typeof filePath === 'function' ? filePath() : filePath || '').trim();
    } catch {
      return '';
    }
  }

  return { append, snapshot, clear, recordStatusTransition, flush, onChange };
}

function normalizeEntry(value = {}) {
  const message = sanitizeText(value.message, 4000).trim();
  if (!message) return null;
  const entry = {
    ts: value.ts || new Date().toISOString(),
    level: normalizeLevel(value.level),
    source: sanitizeLogField(value.source || 'desktop', 80),
    code: sanitizeLogField(value.code, 120),
    message
  };
  for (const [key, limit] of Object.entries({ taskId: 160, eventId: 160, workspace: 120, tool: 120, operation: 240 })) {
    const field = sanitizeLogField(value[key], limit);
    if (field) entry[key] = field;
  }
  return entry;
}

function sanitizeLogField(value, limit) {
  return sanitizeText(value || '', limit).replace(/\s+/g, ' ').trim();
}

function normalizeLevel(value) {
  if (value === 'error') return 'error';
  if (value === 'warning' || value === 'warn') return 'warning';
  return 'info';
}

export { createRuntimeLogBuffer };
