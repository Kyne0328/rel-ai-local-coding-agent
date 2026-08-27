import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { makeProcessEnvironment } from '../processEnvironment.js';
import { resolveSafePath } from '../safety.js';
import { parseWorkspaceSourcePath, qualifyWorkspaceSourcePath, sourceWorkspace, workspaceSourceEntries } from '../workspaceSources.js';
import { isTestPath } from '../repository/intelligence/languages.js';
import { LspClient } from './lspClient.js';

const IDLE_EVICT_MS = 2 * 60 * 1000;
const MAX_SEMANTIC_EDIT_FILES = 100;
const sessions = new Map();

const BUNDLED_ROOT = fileURLToPath(new URL('../../node_modules/', import.meta.url));
const PROVIDERS = Object.freeze([
  provider('typescript-language-server', {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascriptreact',
    '.ts': 'typescript', '.tsx': 'typescriptreact'
  }, {
    manifests: ['package.json', 'tsconfig.json', 'jsconfig.json'],
    executable: process.execPath,
    argv: [path.join(BUNDLED_ROOT, 'typescript-language-server', 'lib', 'cli.mjs'), '--stdio'],
    initializationOptions: { tsserver: { fallbackPath: path.join(BUNDLED_ROOT, 'typescript-lsp-runtime', 'lib', 'tsserver.js') } }
  }),
  provider('pyright', { '.py': 'python', '.pyi': 'python' }, {
    manifests: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'],
    executable: process.execPath,
    argv: [path.join(BUNDLED_ROOT, 'pyright', 'langserver.index.js'), '--stdio']
  }),
  provider('rust-analyzer', { '.rs': 'rust' }, { manifests: ['Cargo.toml'], executable: 'rust-analyzer', argv: [] }),
  provider('gopls', { '.go': 'go' }, { manifests: ['go.mod', 'go.work'], executable: 'gopls', argv: ['serve'] }),
  provider('clangd', {
    '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp'
  }, { manifests: ['compile_commands.json', 'CMakeLists.txt'], executable: 'clangd', argv: ['--background-index'] })
]);

function provider(id, languageByExtension, runtime) {
  return Object.freeze({
    id,
    languageByExtension: Object.freeze({ ...languageByExtension }),
    extensions: Object.freeze(Object.keys(languageByExtension)),
    ...runtime
  });
}

class LspSession {
  constructor(workspace, spec) {
    this.workspace = workspace;
    this.spec = spec;
    this.client = null;
    this.capabilities = {};
    this.openDocuments = new Map();
    this.documentQueue = Promise.resolve();
    this.lastUsedAt = 0;
    this.lastResponseMs = null;
    this.lastError = '';
    this.idleTimer = null;
    this.startPromise = null;
  }

  async ensure(options = {}) {
    this.touch();
    if (this.client && !this.client.closed) return this;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start(options).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async start(options = {}) {
    if (!runtimeAvailable(this.spec)) throw unavailableError(this.spec);
    this.openDocuments.clear();
    const client = new LspClient({
      executable: this.spec.executable,
      argv: this.spec.argv,
      cwd: this.workspace.path,
      env: makeProcessEnvironment(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      name: this.spec.id
    });
    try {
      await client.start();
      const rootUri = pathToFileURL(this.workspace.path).href;
      const initialized = await client.request('initialize', {
        processId: process.pid,
        clientInfo: { name: 'Rel.AI MCP', version: '1' },
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: this.workspace.alias || path.basename(this.workspace.path) }],
        ...(this.spec.initializationOptions ? { initializationOptions: this.spec.initializationOptions } : {}),
        capabilities: {
          workspace: { workspaceFolders: true, configuration: true },
          textDocument: {
            definition: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
            implementation: { dynamicRegistration: false },
            rename: { dynamicRegistration: false, prepareSupport: true },
            documentSymbol: { dynamicRegistration: false },
            diagnostic: { dynamicRegistration: false }
          }
        }
      }, { signal: options.signal });
      this.client = client;
      this.capabilities = initialized?.capabilities || {};
      this.lastError = '';
      client.notify('initialized', {});
      return this;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await client.stop().catch(() => {});
      throw error;
    }
  }

  async request(method, params, options = {}) {
    await this.ensure(options);
    const started = Date.now();
    try {
      const result = await this.client.request(method, params, options);
      this.lastResponseMs = Date.now() - started;
      this.lastError = '';
      this.touch();
      return result;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async positionParams(relativePath, line, column, options = {}) {
    const document = await this.open(relativePath, options);
    return {
      textDocument: { uri: document.uri },
      position: { line: Math.max(0, Number(line || 1) - 1), character: Math.max(0, Number(column || 1) - 1) }
    };
  }

  async open(relativePath, options = {}) {
    const operation = this.documentQueue.then(() => this.openDocument(relativePath, options));
    this.documentQueue = operation.catch(() => {});
    return operation;
  }

  async openDocument(relativePath, options = {}) {
    const safe = resolveSafePath(this.workspace.path, relativePath, { operation: 'read' });
    const text = fs.readFileSync(safe.absolutePath, 'utf8');
    const stat = fs.statSync(safe.absolutePath);
    const current = this.openDocuments.get(safe.relativePath);
    const uri = pathToFileURL(safe.absolutePath).href;
    if (current && current.mtimeMs === stat.mtimeMs && current.size === stat.size) return current;
    await this.ensure(options);
    if (current) this.client.notify('textDocument/didClose', { textDocument: { uri: current.uri } });
    const languageId = languageIdForPath(this.spec, safe.relativePath);
    const document = { uri, text, languageId, version: (current?.version || 0) + 1, mtimeMs: stat.mtimeMs, size: stat.size };
    this.client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version: document.version, text }
    });
    this.openDocuments.set(safe.relativePath, document);
    this.touch();
    return document;
  }

  noteDiskChanges(paths = []) {
    if (!this.client || this.client.closed) return;
    const changes = [];
    for (const relativePath of paths) {
      const current = this.openDocuments.get(relativePath);
      if (current) {
        this.client.notify('textDocument/didClose', { textDocument: { uri: current.uri } });
        this.openDocuments.delete(relativePath);
      }
      try {
        const safe = resolveSafePath(this.workspace.path, relativePath, { operation: 'read' });
        changes.push({ uri: pathToFileURL(safe.absolutePath).href, type: fs.existsSync(safe.absolutePath) ? 2 : 3 });
      } catch {}
    }
    if (changes.length) this.client.notify('workspace/didChangeWatchedFiles', { changes });
  }

  status() {
    return {
      id: this.spec.id,
      available: runtimeAvailable(this.spec),
      active: Boolean(this.client && !this.client.closed),
      authority: 'language-server',
      capabilities: advertisedCapabilities(this.capabilities),
      lastResponseMs: this.lastResponseMs,
      ...(this.lastError ? { error: this.lastError } : {})
    };
  }

  touch() {
    this.lastUsedAt = Date.now();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.stop(), IDLE_EVICT_MS);
    this.idleTimer.unref?.();
  }

  async stop() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const client = this.client;
    this.client = null;
    this.openDocuments.clear();
    if (client) await client.stop().catch(() => {});
  }
}

function providerForPath(relativePath) {
  const ext = path.extname(String(relativePath || '')).toLowerCase();
  return PROVIDERS.find(item => item.extensions.includes(ext)) || null;
}

function languageIdForPath(spec, relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  return spec.languageByExtension[ext] || '';
}

function sessionKey(workspace, spec) {
  return `${workspace.path}\0${spec.id}`;
}

function getSession(workspace, spec) {
  const key = sessionKey(workspace, spec);
  let session = sessions.get(key);
  if (!session) {
    session = new LspSession(workspace, spec);
    sessions.set(key, session);
  }
  return session;
}

async function inspectWithLsp(workspace, args, anchor, options = {}) {
  const requestedPath = String(anchor?.path || args.path || '').replaceAll('\\', '/');
  const parsed = parseWorkspaceSourcePath(workspace, requestedPath);
  const relativePath = parsed.relativePath;
  const scopedWorkspace = sourceWorkspace(workspace, parsed.source);
  const spec = providerForPath(relativePath);
  if (!spec) return { available: false, reason: 'no-language-server-provider' };
  const session = getSession(scopedWorkspace, spec);
  if (!runtimeAvailable(spec)) return { available: false, provider: spec.id, reason: 'language-server-unavailable', status: session.status() };
  const line = Number(anchor?.line || args.line || 1);
  const column = Number(anchor?.column || args.column || 1);
  try {
    const position = await session.positionParams(relativePath, line, column, options);
    const action = String(args.action || '').toLowerCase();
    let raw;
    if (action === 'definition') raw = await session.request('textDocument/definition', position, options);
    else if (action === 'references') raw = await session.request('textDocument/references', { ...position, context: { includeDeclaration: true } }, options);
    else if (action === 'hover' || action === 'symbol') raw = await session.request('textDocument/hover', position, options);
    else if (action === 'implementation') raw = await session.request('textDocument/implementation', position, options);
    else return { available: false, provider: spec.id, reason: 'unsupported-lsp-action', status: session.status() };
    return {
      available: true,
      provider: spec.id,
      authority: 'language-server',
      path: qualifyWorkspaceSourcePath(parsed.source, relativePath),
      line,
      column,
      result: normalizeLspResult(scopedWorkspace, action, raw, parsed.source),
      status: session.status()
    };
  } catch (error) {
    return {
      available: false,
      provider: spec.id,
      reason: 'language-server-request-failed',
      error: error instanceof Error ? error.message : String(error),
      status: session.status()
    };
  }
}

async function planSemanticRename(workspace, semantic, options = {}) {
  const requestedPath = String(semantic?.path || '').trim().replaceAll('\\', '/');
  if (!requestedPath) throw new Error('Semantic rename requires semantic.path.');
  const parsed = parseWorkspaceSourcePath(workspace, requestedPath);
  if (!parsed.source.primary) throw new Error('Semantic rename is available only in the primary repository. Secondary source folders are read-only context.');
  const relativePath = parsed.relativePath;
  const newName = String(semantic?.newName || '').trim();
  if (!newName || newName.length > 256) throw new Error('Semantic rename requires semantic.newName between 1 and 256 characters.');
  const spec = providerForPath(relativePath);
  if (!spec) throw new Error(`No language-server provider supports semantic rename for ${relativePath}.`);
  const session = getSession(workspace, spec);
  if (!runtimeAvailable(spec)) throw unavailableError(spec);
  const position = await session.positionParams(relativePath, semantic.line, semantic.column, options);
  if (session.capabilities?.renameProvider && typeof session.capabilities.renameProvider === 'object' && session.capabilities.renameProvider.prepareProvider) {
    await session.request('textDocument/prepareRename', position, options);
  }
  const workspaceEdit = await session.request('textDocument/rename', { ...position, newName }, options);
  const edits = materializeWorkspaceEdit(workspace, workspaceEdit);
  if (!edits.length) throw new Error(`${spec.id} returned no edits for semantic rename.`);
  if (edits.length > MAX_SEMANTIC_EDIT_FILES) {
    throw new Error(`Semantic rename touches ${edits.length} files; Rel.AI accepts at most ${MAX_SEMANTIC_EDIT_FILES} files in one atomic semantic edit.`);
  }
  return {
    provider: spec.id,
    authority: 'language-server',
    operation: 'rename',
    path: relativePath,
    line: Number(semantic.line),
    column: Number(semantic.column),
    newName,
    edits
  };
}

function materializeWorkspaceEdit(workspace, workspaceEdit = {}) {
  const byUri = new Map();
  for (const [uri, textEdits] of Object.entries(workspaceEdit?.changes || {})) byUri.set(uri, [...(textEdits || [])]);
  for (const change of workspaceEdit?.documentChanges || []) {
    if (!change?.textDocument?.uri || !Array.isArray(change.edits)) {
      if (change?.kind) throw new Error(`Semantic rename refused unsupported LSP resource operation '${change.kind}'.`);
      continue;
    }
    const uri = change.textDocument.uri;
    byUri.set(uri, [...(byUri.get(uri) || []), ...change.edits]);
  }
  const edits = [];
  for (const [uri, textEdits] of byUri) {
    const relativePath = workspaceRelativeUri(workspace, uri);
    if (!relativePath) throw new Error(`Semantic rename refused language-server edit outside the active workspace: ${String(uri || 'unknown URI')}`);
    const safe = resolveSafePath(workspace.path, relativePath, { operation: 'write' });
    const original = fs.readFileSync(safe.absolutePath, 'utf8');
    const content = applyTextEdits(original, textEdits);
    if (content === original) continue;
    edits.push({ path: safe.relativePath, content, expectedSha256: sha256(original) });
  }
  return edits.sort((left, right) => left.path.localeCompare(right.path));
}

function applyTextEdits(text, edits) {
  const normalized = edits.map(edit => ({
    start: offsetAt(text, edit.range?.start),
    end: offsetAt(text, edit.range?.end),
    newText: String(edit.newText ?? '')
  })).sort((left, right) => right.start - left.start || right.end - left.end);
  let output = text;
  let previousStart = Number.POSITIVE_INFINITY;
  for (const edit of normalized) {
    if (edit.end > previousStart) throw new Error('Language server returned overlapping semantic rename edits.');
    output = output.slice(0, edit.start) + edit.newText + output.slice(edit.end);
    previousStart = edit.start;
  }
  return output;
}

function offsetAt(text, position = {}) {
  const targetLine = Math.max(0, Number(position.line || 0));
  const targetCharacter = Math.max(0, Number(position.character || 0));
  let offset = 0;
  let line = 0;
  while (line < targetLine && offset < text.length) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return text.length;
    offset = next + 1;
    line += 1;
  }
  return Math.min(text.length, offset + targetCharacter);
}

function normalizeLspResult(workspace, action, raw, source = null) {
  if (action === 'hover' || action === 'symbol') return normalizeHover(raw);
  const locations = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return locations.map(item => normalizeLocation(workspace, item, source)).filter(Boolean);
}

function normalizeHover(raw) {
  if (!raw) return null;
  const contents = raw.contents;
  const values = Array.isArray(contents) ? contents : [contents];
  const text = values.map(item => {
    if (typeof item === 'string') return item;
    if (item && typeof item.value === 'string') return item.value;
    return '';
  }).filter(Boolean).join('\n\n').slice(0, 12_000);
  return {
    text,
    ...(raw.range ? { range: normalizeRange(raw.range) } : {})
  };
}

function normalizeLocation(workspace, item, source = null) {
  const uri = item?.uri || item?.targetUri;
  const range = item?.range || item?.targetSelectionRange || item?.targetRange;
  const relativePath = workspaceRelativeUri(workspace, uri);
  if (!relativePath || !range) return null;
  return {
    path: source ? qualifyWorkspaceSourcePath(source, relativePath) : relativePath,
    line: Number(range.start?.line || 0) + 1,
    column: Number(range.start?.character || 0) + 1,
    endLine: Number(range.end?.line || 0) + 1,
    endColumn: Number(range.end?.character || 0) + 1,
    test: isTestPath(relativePath),
    provider: 'lsp',
    confidence: 1
  };
}

function normalizeRange(range = {}) {
  return {
    line: Number(range.start?.line || 0) + 1,
    column: Number(range.start?.character || 0) + 1,
    endLine: Number(range.end?.line || 0) + 1,
    endColumn: Number(range.end?.character || 0) + 1
  };
}

function workspaceRelativeUri(workspace, uri) {
  if (!String(uri || '').startsWith('file:')) return '';
  let absolute;
  try { absolute = fileURLToPath(uri); } catch { return ''; }
  const relative = path.relative(workspace.path, absolute);
  if (!relative || relative === '.') return '';
  if (relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return relative.replaceAll('\\', '/');
}

function providerStatuses(workspace) {
  const result = [];
  for (const source of workspaceSourceEntries(workspace)) {
    const scopedWorkspace = sourceWorkspace(workspace, source);
    for (const spec of PROVIDERS) {
      if (!sessions.has(sessionKey(scopedWorkspace, spec)) && !workspaceHintsProvider(scopedWorkspace, spec)) continue;
      const session = sessions.get(sessionKey(scopedWorkspace, spec));
      result.push({
        ...(session?.status() || {
          id: spec.id,
          available: runtimeAvailable(spec),
          active: false,
          authority: 'language-server',
          capabilities: []
        }),
        ...(source.primary ? {} : { source: source.number })
      });
    }
  }
  return result;
}

function workspaceHintsProvider(workspace, spec) {
  if (spec.manifests.some(name => fs.existsSync(path.join(workspace.path, name)))) return true;
  return false;
}

function runtimeAvailable(spec) {
  if (path.isAbsolute(spec.executable)) {
    if (!fs.existsSync(spec.executable)) return false;
    return spec.argv.length === 0 || !path.isAbsolute(spec.argv[0]) || fs.existsSync(spec.argv[0]);
  }
  return Boolean(findExecutable(spec.executable));
}

function findExecutable(name) {
  const pathValue = String(process.env.PATH || '');
  const extensions = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.join(directory, process.platform === 'win32' ? `${name}${ext}` : name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return '';
}

function advertisedCapabilities(capabilities = {}) {
  const mapping = [
    ['definition', 'definitionProvider'],
    ['references', 'referencesProvider'],
    ['hover', 'hoverProvider'],
    ['implementation', 'implementationProvider'],
    ['rename', 'renameProvider'],
    ['documentSymbols', 'documentSymbolProvider'],
    ['diagnostics', 'diagnosticProvider']
  ];
  return mapping.filter(([, key]) => Boolean(capabilities?.[key])).map(([name]) => name);
}

function unavailableError(spec) {
  const error = new Error(`Language server '${spec.id}' is unavailable.`);
  error.code = 'LSP_UNAVAILABLE';
  return error;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function noteLspMutation(workspace, paths = []) {
  for (const spec of PROVIDERS) sessions.get(sessionKey(workspace, spec))?.noteDiskChanges(paths);
}

async function disposeLspWorkspace(workspace) {
  const active = [];
  for (const source of workspaceSourceEntries(workspace)) {
    const scopedWorkspace = sourceWorkspace(workspace, source);
    for (const spec of PROVIDERS) {
      const key = sessionKey(scopedWorkspace, spec);
      const session = sessions.get(key);
      if (!session) continue;
      sessions.delete(key);
      active.push(session);
    }
  }
  await Promise.allSettled(active.map(session => session.stop()));
}

async function shutdownLspSessions() {
  const active = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled(active.map(session => session.stop()));
}

export {
  IDLE_EVICT_MS,
  MAX_SEMANTIC_EDIT_FILES,
  disposeLspWorkspace,
  inspectWithLsp,
  noteLspMutation,
  planSemanticRename,
  providerForPath,
  providerStatuses,
  shutdownLspSessions
};
