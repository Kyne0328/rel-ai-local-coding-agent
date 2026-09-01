import { toast } from '../../components/toast.js';
import { getRouteParams, replaceRouteParams } from '../../router.js';
import { esc } from '../../utils.js';

let activeState = null;
let monacoPromise = null;

export async function mountCode(container, data = {}) {
  disposeActiveState();
  const root = document.createElement('div');
  root.className = 'section code-page';
  container.replaceChildren(root);

  const bridge = window.relaiDesktop?.codeWorkspace;
  if (!bridge) {
    root.innerHTML = desktopOnlyHtml();
    return;
  }

  const tasks = codeTasks(data);
  if (!tasks.length) {
    root.innerHTML = emptyHtml();
    return;
  }

  root.innerHTML = shellHtml(tasks);
  const state = {
    root,
    bridge,
    data,
    tasks,
    taskId: '',
    workspace: null,
    filePath: '',
    monaco: null,
    diffEditor: null,
    models: [],
    refreshGeneration: 0
  };
  activeState = state;
  bindShell(state);
  await loadEditors(state);
  const requested = String(getRouteParams().get('task') || '').trim();
  const initial = tasks.some(task => task.id === requested) ? requested : tasks[0].id;
  state.root.querySelector('[data-code-task]').value = initial;
  await switchTask(state, initial, { updateRoute: requested !== initial });
}

export function updateCodeLiveState(container, data = {}) {
  const state = activeState;
  if (!state || state.root !== container.querySelector('.code-page')) return false;
  state.data = data;
  const nextTasks = codeTasks(data);
  state.tasks = nextTasks;
  syncTaskOptions(state, nextTasks);
  if (!state.taskId || !nextTasks.some(task => task.id === state.taskId)) return true;
  void refreshWorkspace(state, { refreshCurrent: false });
  return true;
}

function bindShell(state) {
  const taskSelect = state.root.querySelector('[data-code-task]');
  const search = state.root.querySelector('[data-code-search]');
  const refresh = state.root.querySelector('[data-code-refresh]');
  const openIde = state.root.querySelector('[data-code-open-ide]');

  taskSelect.addEventListener('change', async () => {
    await switchTask(state, taskSelect.value, { updateRoute: true });
  });
  search.addEventListener('input', () => renderFiles(state));
  refresh.addEventListener('click', () => refreshWorkspace(state, { refreshCurrent: true }));
  openIde.addEventListener('click', () => openInIde(state));
  window.addEventListener('pagehide', disposeActiveState, { once: true });
}

async function switchTask(state, taskId, options = {}) {
  state.taskId = String(taskId || '').trim();
  state.workspace = null;
  state.filePath = '';
  disposeEditor(state);
  renderFileHeading(state, '');
  setViewerMessage(state, 'Loading task changes…');
  if (options.updateRoute) replaceRouteParams({ task: state.taskId });
  await refreshWorkspace(state, { refreshCurrent: false });
}

async function refreshWorkspace(state, options = {}) {
  const generation = ++state.refreshGeneration;
  try {
    const workspace = await state.bridge.get(state.taskId);
    if (generation !== state.refreshGeneration || activeState !== state) return;
    state.workspace = workspace;
    const changedFiles = changedTextFiles(workspace);
    if (state.filePath && !changedFiles.includes(state.filePath)) {
      state.filePath = '';
      renderFileHeading(state, '');
      setViewerMessage(state, emptyViewerMessage(workspace));
    }
    renderWorkspaceMeta(state);
    renderFiles(state);
    if (options.refreshCurrent && state.filePath) {
      await openFile(state, state.filePath, { preserveSelection: true });
      return;
    }
    if (!state.filePath) {
      const first = changedFiles[0] || '';
      if (first) await openFile(state, first);
      else setViewerMessage(state, emptyViewerMessage(workspace));
    }
  } catch (error) {
    renderWorkspaceError(state, error);
  }
}

function renderWorkspaceMeta(state) {
  const workspace = state.workspace || {};
  const meta = state.root.querySelector('[data-code-meta]');
  const viewState = state.root.querySelector('[data-code-view-state]');
  if (meta) {
    const parts = [workspace.workspace || 'Project'];
    if (workspace.status) parts.push(humanizeStatus(workspace.status));
    if (workspace.historyMode === 'committed') {
      const head = shortCommit(workspace.commitHead);
      parts.push(head ? `Committed changes · ${head}` : 'Committed changes');
      if (workspace.commitSource === 'inferred') parts.push('Recovered from Git history');
    } else if (workspace.historyMode === 'unavailable') {
      parts.push('Historical diff unavailable');
    } else {
      parts.push('Current task changes');
    }
    meta.textContent = parts.join(' · ');
  }
  if (viewState) {
    viewState.textContent = workspace.historyMode === 'unavailable'
      ? 'Recorded files only'
      : 'Read-only diff';
  }
}

function changedTextFiles(workspace = {}) {
  return [...new Set((Array.isArray(workspace.changedFiles) ? workspace.changedFiles : [])
    .map(file => String(file || '').trim())
    .filter(Boolean))];
}

function changedFileStatus(workspace = {}, file = '') {
  const raw = workspace.changedFileStatuses?.[file];
  if (!raw || typeof raw !== 'object') return { code: 'M', label: 'Modified', tone: 'warning' };
  const code = String(raw.code || 'M').slice(0, 1).toUpperCase();
  const label = String(raw.label || 'Modified');
  const tone = ['info', 'success', 'warning', 'danger', 'neutral'].includes(raw.tone) ? raw.tone : 'neutral';
  return { code, label, tone };
}

function renderFiles(state) {
  const list = state.root.querySelector('[data-code-files]');
  if (!list) return;
  const workspace = state.workspace || {};
  const query = String(state.root.querySelector('[data-code-search]')?.value || '').trim().toLowerCase();
  const files = changedTextFiles(workspace).filter(file => !query || file.toLowerCase().includes(query));
  if (!files.length) {
    list.innerHTML = `<div class="code-file-empty">${query ? 'No matching changed files.' : 'No task-owned changes to review.'}</div>`;
    return;
  }
  list.innerHTML = files.map(file => {
    const status = changedFileStatus(workspace, file);
    return `
    <button class="code-file-row${file === state.filePath ? ' active' : ''}" type="button" data-code-file="${esc(file)}" title="${esc(`${status.label}: ${file}`)}" aria-label="${esc(`${status.label}: ${file}`)}">
      <span class="code-file-marker status-${esc(status.tone)}" aria-hidden="true">${esc(status.code)}</span>
      <span class="code-file-name">${esc(file)}</span>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-code-file]').forEach(button => {
    button.addEventListener('click', async () => {
      const next = button.dataset.codeFile || '';
      if (next === state.filePath) return;
      await openFile(state, next);
    });
  });
}

async function openFile(state, filePath, options = {}) {
  const path = String(filePath || '').trim();
  if (!path) return;
  const previous = state.filePath;
  try {
    const file = await state.bridge.diff(state.taskId, path);
    if (activeState !== state) return;
    state.filePath = path;
    renderFiles(state);
    renderFileHeading(state, path);
    await renderDiff(state, file, options);
  } catch (error) {
    state.filePath = previous;
    renderFiles(state);
    setViewerMessage(state, messageFor(error), 'error');
  }
}

async function renderDiff(state, file, options = {}) {
  const host = state.root.querySelector('[data-code-editor]');
  if (!host) return;
  disposeEditor(state);
  host.className = 'code-editor-host';
  host.textContent = '';
  try {
    const monaco = await loadMonaco();
    if (activeState !== state) return;
    state.monaco = monaco;
    const theme = document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark';
    const original = monaco.editor.createModel(file.baseContent || '', file.language || 'plaintext');
    const modified = monaco.editor.createModel(file.content || '', file.language || 'plaintext');
    state.models.push(original, modified);
    state.diffEditor = monaco.editor.createDiffEditor(host, {
      theme,
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderIndicators: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      fontLigatures: true
    });
    state.diffEditor.setModel({ original, modified });
    if (!options.preserveSelection) state.diffEditor.getModifiedEditor().focus();
  } catch (error) {
    renderTextFallback(state, file, error);
  }
}

function renderTextFallback(state, file, error) {
  const host = state.root.querySelector('[data-code-editor]');
  host.innerHTML = '';
  const fallback = document.createElement('div');
  fallback.className = 'code-diff-fallback';
  fallback.append(
    fallbackColumn('Before', file.baseContent || ''),
    fallbackColumn('After', file.content || '')
  );
  host.appendChild(fallback);
  toast(`Monaco could not start. Showing a read-only text diff fallback. ${messageFor(error)}`, { variant: 'warn' });
}

function fallbackColumn(label, content) {
  const column = document.createElement('section');
  column.className = 'code-diff-column';
  const heading = document.createElement('strong');
  heading.textContent = label;
  const pre = document.createElement('pre');
  pre.textContent = content;
  column.append(heading, pre);
  return column;
}

async function loadEditors(state) {
  const select = state.root.querySelector('[data-code-ide]');
  try {
    const result = await state.bridge.editors();
    const editors = Array.isArray(result?.editors) ? result.editors : [];
    select.innerHTML = editors.map(editor => `<option value="${esc(editor.id)}">${esc(editor.label)}</option>`).join('');
    state.root.querySelector('[data-code-open-ide]').disabled = editors.length === 0;
  } catch (_error) {
    select.innerHTML = '<option value="">IDE unavailable</option>';
    state.root.querySelector('[data-code-open-ide]').disabled = true;
  }
}

async function openInIde(state) {
  const editorId = state.root.querySelector('[data-code-ide]')?.value || '';
  if (!editorId || !state.taskId) return;
  const button = state.root.querySelector('[data-code-open-ide]');
  button.disabled = true;
  try {
    const result = await state.bridge.openIde(state.taskId, editorId);
    toast(`Opened this project in ${result?.editor?.label || 'the selected application'}.`, { variant: 'success' });
  } catch (error) {
    toast(messageFor(error), { variant: 'error' });
  } finally {
    button.disabled = false;
  }
}

function renderFileHeading(state, path) {
  const heading = state.root.querySelector('[data-code-file-heading]');
  if (heading) heading.textContent = path || 'No file selected';
}

function setViewerMessage(state, message, tone = '') {
  const host = state.root.querySelector('[data-code-editor]');
  if (!host) return;
  disposeEditor(state);
  host.className = `code-editor-host code-editor-message${tone ? ` ${tone}` : ''}`;
  host.textContent = message;
}

function renderWorkspaceError(state, error) {
  state.workspace = null;
  state.root.querySelector('[data-code-files]').innerHTML = '<div class="code-file-empty">Task changes are unavailable.</div>';
  setViewerMessage(state, messageFor(error), 'error');
  const meta = state.root.querySelector('[data-code-meta]');
  if (meta) meta.textContent = 'Task changes unavailable';
}

function syncTaskOptions(state, tasks) {
  const select = state.root.querySelector('[data-code-task]');
  if (!select) return;
  const current = select.value;
  select.innerHTML = taskOptionsHtml(tasks);
  if (tasks.some(task => task.id === current)) select.value = current;
}

function disposeEditor(state) {
  try { state.diffEditor?.dispose?.(); } catch {}
  state.diffEditor = null;
  for (const model of state.models || []) {
    try { model.dispose?.(); } catch {}
  }
  state.models = [];
}

function disposeActiveState() {
  if (!activeState) return;
  disposeEditor(activeState);
  activeState = null;
}

function codeTasks(data = {}) {
  return (Array.isArray(data.tasks) ? data.tasks : [])
    .map(task => ({
      id: taskId(task),
      label: taskLabel(task),
      status: String(task.status || ''),
      workspace: String(task.workspace || '')
    }))
    .filter(task => task.id);
}

function taskId(task) {
  return String(task?.work_id || task?.taskId || task?.id || '').trim();
}

function taskLabel(task) {
  const title = String(task?.title || task?.objective || task?.summary || 'Untitled task').trim();
  const workspace = String(task?.workspace || '').trim();
  const status = String(task?.status || '').trim();
  return [title, workspace, status].filter(Boolean).join(' · ');
}

function taskOptionsHtml(tasks) {
  return tasks.map(task => `<option value="${esc(task.id)}">${esc(task.label)}</option>`).join('');
}

function shellHtml(tasks) {
  return `
    <div class="feature-toolbar code-toolbar">
      <div class="code-task-control">
        <label for="codeTaskSelect">Task</label>
        <select id="codeTaskSelect" data-code-task>${taskOptionsHtml(tasks)}</select>
      </div>
      <div class="code-toolbar-actions">
        <select data-code-ide aria-label="Application for project"><option>Loading applications…</option></select>
        <button class="secondary" type="button" data-code-open-ide>Open in IDE</button>
        <button class="secondary" type="button" data-code-refresh>Refresh</button>
      </div>
    </div>
    <div class="code-workspace-meta" data-code-meta>Loading task changes…</div>
    <div class="code-workbench">
      <aside class="code-explorer" aria-label="Changed task files">
        <div class="code-explorer-head">
          <strong>Changed files</strong>
          <input type="search" data-code-search placeholder="Filter changed files" aria-label="Filter changed task files">
        </div>
        <div class="code-file-list" data-code-files><div class="code-file-empty">Loading changes…</div></div>
      </aside>
      <section class="code-editor-pane" aria-label="Task diff viewer">
        <div class="code-editor-toolbar">
          <div class="code-file-heading mono" data-code-file-heading>No file selected</div>
          <span class="code-view-state" data-code-view-state>Read-only diff</span>
        </div>
        <div class="code-editor-host code-editor-message" data-code-editor>Choose a changed file to review its diff.</div>
      </section>
    </div>`;
}

function desktopOnlyHtml() {
  return '<div class="dashboard-state"><div class="dashboard-state-card"><span class="status-pill warn">Desktop feature</span><h2>Open Changes in the Rel.AI desktop app.</h2><p>The browser dashboard cannot access local task diffs or IDEs.</p></div></div>';
}

function emptyHtml() {
  return '<div class="dashboard-state"><div class="dashboard-state-card"><h2>No task changes are available.</h2><p>Start a Rel.AI task, then return here to review what changed.</p><div class="dashboard-state-actions"><a class="buttonlike primary" href="#tasks">Open tasks</a></div></div></div>';
}

function emptyViewerMessage(workspace = {}) {
  if (workspace.historyMode === 'unavailable') return 'This task records changed files, but its historical Git diff cannot be identified safely.';
  const status = String(workspace.status || '').toLowerCase();
  if (['completed', 'cancelled', 'failed'].includes(status)) return 'This task has no recorded file changes.';
  return 'No task-owned changes to review yet.';
}

function humanizeStatus(value) {
  const text = String(value || '').trim().replaceAll('_', ' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function shortCommit(value) {
  const text = String(value || '').trim();
  return /^[a-f0-9]{7,64}$/i.test(text) ? text.slice(0, 8) : '';
}

function messageFor(error) {
  return error instanceof Error ? error.message : String(error || 'The changes viewer request failed.');
}

function loadMonaco() {
  if (window.monaco?.editor) return Promise.resolve(window.monaco);
  if (monacoPromise) return monacoPromise;
  monacoPromise = new Promise((resolve, reject) => {
    const start = () => {
      if (typeof window.require !== 'function') {
        reject(new Error('Monaco loader did not initialize.'));
        return;
      }
      window.MonacoEnvironment = {
        getWorkerUrl(_moduleId, label) {
          if (label === 'json') return '/vendor/monaco/language/json/json.worker.js';
          if (['css', 'scss', 'less'].includes(label)) return '/vendor/monaco/language/css/css.worker.js';
          if (['html', 'handlebars', 'razor'].includes(label)) return '/vendor/monaco/language/html/html.worker.js';
          if (['typescript', 'javascript'].includes(label)) return '/vendor/monaco/language/typescript/ts.worker.js';
          return '/vendor/monaco/editor/editor.worker.js';
        }
      };
      window.require.config({ paths: { vs: '/vendor/monaco' } });
      window.require([
        'vs/editor/editor.main',
        'vs/basic-languages/monaco.contribution'
      ], () => resolve(window.monaco), reject);
    };
    const existing = document.querySelector('script[data-monaco-loader]');
    if (existing) {
      if (typeof window.require === 'function') start();
      else existing.addEventListener('load', start, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = '/vendor/monaco/loader.js';
    script.dataset.monacoLoader = 'true';
    script.addEventListener('load', start, { once: true });
    script.addEventListener('error', () => reject(new Error('Monaco editor assets could not load.')), { once: true });
    document.head.appendChild(script);
  });
  return monacoPromise;
}
