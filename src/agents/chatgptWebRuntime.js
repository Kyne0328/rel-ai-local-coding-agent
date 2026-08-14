import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from 'playwright-core';

import { resolveChromiumRuntime } from '../chromiumRuntime.js';
import { readJsonFile, writeJsonAtomic } from '../durableState.js';
import { getStateDir } from '../statePaths.js';
import { ChatGptPageAdapter } from './chatgptPageAdapter.js';
import { normalizeAgentTaskInput, normalizeReasoningLevel, resolveReasoningLevel } from './contracts.js';
import { AgentRuntime } from './runtime.js';

const DEFAULT_CHATGPT_URL = 'https://chatgpt.com/';
const DEFAULT_REASONING = Object.freeze(['medium']);
const RUNTIME_TASK_ID = /^chatgpt_agent_[A-Za-z0-9_-]{20,160}$/;

class ChatGptWebRuntime extends AgentRuntime {
  constructor(options = {}) {
    super('chatgpt-web');
    if (!options.config || typeof options.config !== 'object') throw new Error('ChatGPT web runtime config is required.');
    this.config = options.config;
    this.pageAdapter = options.pageAdapter || new ChatGptPageAdapter();
    assertPageAdapter(this.pageAdapter);
    this.browserFactory = options.browserFactory || defaultBrowserFactory();
    this.runtimeResolver = options.runtimeResolver || defaultRuntimeResolver;
    this.chatgptUrl = normalizeChatGptUrl(options.chatgptUrl || DEFAULT_CHATGPT_URL);
    this.profilePath = path.resolve(options.profilePath || path.join(getStateDir(this.config), 'agents', 'chatgpt-web-profile'));
    this.metadataPath = path.join(getStateDir(this.config), 'agents', 'chatgpt-web.json');
    const saved = readRuntimeMetadata(this.metadataPath);
    this.availableReasoning = normalizeReasoning(options.availableReasoning || saved?.reasoning || DEFAULT_REASONING);
    this.authContext = null;
    this.authPage = null;
    this.executionContext = null;
    this.executionContextPromise = null;
    this.startingAgents = 0;
    this.sessions = new Map();
  }

  async getCapabilities() {
    return {
      runtime: this.name,
      reasoning: [...this.availableReasoning],
      temporaryChats: true,
      structuredCompletion: true,
      requiresAuthentication: true,
      outputTransport: 'mcp'
    };
  }

  authenticationStatus() {
    const saved = readRuntimeMetadata(this.metadataPath);
    return {
      runtime: this.name,
      status: this.authContext ? 'authentication_open' : saved?.authenticatedAt ? 'authentication_saved' : 'not_authenticated',
      authenticatedAt: saved?.authenticatedAt || null,
      reasoning: this.authContext || !Array.isArray(saved?.reasoning) ? [] : normalizeReasoning(saved.reasoning),
      browser: this.browserStatus()
    };
  }

  browserStatus() {
    try {
      const runtime = this.resolveRuntime();
      return {
        available: true,
        product: String(runtime.product || 'Chromium'),
        errorCode: null
      };
    } catch {
      return {
        available: false,
        product: null,
        errorCode: 'CHATGPT_RUNTIME_UNAVAILABLE'
      };
    }
  }

  async beginAuthentication() {
    if (this.sessions.size || this.startingAgents) throw runtimeError('CHATGPT_AGENTS_ACTIVE', 'Close active ChatGPT subagents before opening the login window.');
    if (this.authContext) return { runtime: this.name, status: 'authentication_open' };
    await this.closeExecutionContext();
    const runtime = this.resolveRuntime();
    ensurePrivateDirectory(this.profilePath);
    this.authContext = await this.browserFactory.launchPersistentContext(this.profilePath, {
      executablePath: runtime.executablePath,
      headless: false,
      acceptDownloads: false
    });
    try {
      this.authPage = firstPage(this.authContext) || await this.authContext.newPage();
      await navigateToChatGpt(this.authPage, this.chatgptUrl);
      return {
        runtime: this.name,
        status: 'authentication_open',
        browserProduct: runtime.product
      };
    } catch (error) {
      await this.closeAuthenticationContext();
      throw error;
    }
  }

  async finishAuthentication() {
    if (!this.authContext || !this.authPage) {
      throw runtimeError('CHATGPT_AUTH_NOT_OPEN', 'Open the ChatGPT login window before finishing authentication.');
    }
    const authenticated = await this.pageAdapter.isAuthenticated(this.authPage);
    if (!authenticated) throw runtimeError('CHATGPT_LOGIN_REQUIRED', 'ChatGPT login is not complete yet.');
    const discovered = await discoverReasoning(this.pageAdapter, this.authPage);
    if (discovered.length) this.availableReasoning = normalizeReasoning(discovered);
    const authenticatedAt = new Date().toISOString();
    const reasoning = [...this.availableReasoning];
    await this.closeAuthenticationContext();
    writeJsonAtomic(this.metadataPath, { schemaVersion: 1, authenticatedAt, reasoning }, { mode: 0o600 });
    return { runtime: this.name, status: 'authenticated', authenticatedAt, reasoning };
  }

  async spawn(input, context = {}) {
    if (this.authContext) throw runtimeError('CHATGPT_AUTH_IN_PROGRESS', 'Finish or close the ChatGPT login window before starting a subagent.');
    const prompt = String(context.prompt || '').trim();
    if (!prompt) throw runtimeError('CHATGPT_PROMPT_REQUIRED', 'ChatGPT web runtime requires the delegated agent prompt.');
    const task = normalizeAgentTaskInput(input);
    const reasoning = resolveReasoningLevel(task.reasoning, this.availableReasoning);
    this.startingAgents += 1;
    let page;
    const runtimeTaskId = `chatgpt_agent_${crypto.randomBytes(24).toString('base64url')}`;
    try {
      const browserContext = await this.ensureExecutionContext();
      page = await browserContext.newPage();
      await navigateToChatGpt(page, this.chatgptUrl);
      if (!await this.pageAdapter.isAuthenticated(page)) {
        throw runtimeError('CHATGPT_LOGIN_REQUIRED', 'ChatGPT session is not authenticated. Open the login window and sign in again.');
      }
      await this.pageAdapter.prepareSession(page, { temporary: true, reasoning });
      await this.pageAdapter.submitPrompt(page, prompt);
      this.sessions.set(runtimeTaskId, {
        runtimeTaskId,
        agentId: String(context.agentId || ''),
        page,
        reasoning,
        createdAt: new Date().toISOString()
      });
      return { runtimeTaskId, reasoning };
    } catch (error) {
      await page?.close().catch(() => {});
      throw error;
    } finally {
      this.startingAgents -= 1;
    }
  }

  async cancel(runtimeTaskId) {
    const id = String(runtimeTaskId || '').trim();
    if (!RUNTIME_TASK_ID.test(id)) return { cancelled: false, alreadyTerminal: true };
    const record = this.sessions.get(id);
    if (!record) return { cancelled: false, alreadyTerminal: true };
    this.sessions.delete(id);
    await record.page.close().catch(() => {});
    return { cancelled: true, alreadyTerminal: false };
  }

  async dispose() {
    const records = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(records.map(record => record.page.close()));
    await this.closeExecutionContext();
    await this.closeAuthenticationContext();
  }

  resolveRuntime() {
    try {
      return this.runtimeResolver({
        override: String(process.env.REL_AI_CHATGPT_CHROMIUM_PATH || process.env.REL_AI_UI_CHROMIUM_PATH || '').trim()
      });
    } catch (error) {
      throw runtimeError(
        'CHATGPT_RUNTIME_UNAVAILABLE',
        error instanceof Error ? error.message : 'No supported Chromium runtime is available.',
        error
      );
    }
  }

  async ensureExecutionContext() {
    if (this.executionContext) return this.executionContext;
    if (!this.executionContextPromise) {
      this.executionContextPromise = this.openExecutionContext();
    }
    try {
      return await this.executionContextPromise;
    } finally {
      this.executionContextPromise = null;
    }
  }

  async openExecutionContext() {
    const runtime = this.resolveRuntime();
    ensurePrivateDirectory(this.profilePath);
    const context = await this.browserFactory.launchPersistentContext(this.profilePath, {
      executablePath: runtime.executablePath,
      headless: true,
      acceptDownloads: false
    });
    this.executionContext = context;
    return context;
  }

  async closeExecutionContext() {
    if (this.executionContextPromise) await this.executionContextPromise.catch(() => {});
    const context = this.executionContext;
    this.executionContext = null;
    if (context) await context.close().catch(() => {});
  }

  async closeAuthenticationContext() {
    const context = this.authContext;
    this.authContext = null;
    this.authPage = null;
    if (context) await context.close().catch(() => {});
  }
}

function defaultBrowserFactory() {
  return {
    launchPersistentContext(userDataDir, options) {
      return chromium.launchPersistentContext(userDataDir, options);
    }
  };
}

function defaultRuntimeResolver(options) {
  return resolveChromiumRuntime(options);
}

function assertPageAdapter(adapter) {
  for (const method of ['isAuthenticated', 'prepareSession', 'submitPrompt']) {
    if (!adapter || typeof adapter[method] !== 'function') throw new Error(`ChatGPT page adapter must implement ${method}().`);
  }
}

function normalizeReasoning(values) {
  const levels = [...new Set((values || []).map(normalizeReasoningLevel))];
  if (!levels.length) throw new Error('ChatGPT web runtime requires at least one reasoning level.');
  return levels;
}

function readRuntimeMetadata(file) {
  try { return readJsonFile(file, { fallback: null }); } catch { return null; }
}

async function discoverReasoning(adapter, page) {
  if (typeof adapter?.listReasoningLevels !== 'function') return [];
  try {
    const levels = await adapter.listReasoningLevels(page);
    return Array.isArray(levels) ? levels : [];
  } catch {
    return [];
  }
}

function normalizeChatGptUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com'].includes(url.hostname)) {
    throw new Error('ChatGPT runtime URL must use https://chatgpt.com.');
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href;
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function firstPage(context) {
  const pages = typeof context.pages === 'function' ? context.pages() : [];
  return Array.isArray(pages) ? pages[0] || null : null;
}

async function navigateToChatGpt(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
}

function runtimeError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

export { ChatGptWebRuntime, DEFAULT_CHATGPT_URL };
