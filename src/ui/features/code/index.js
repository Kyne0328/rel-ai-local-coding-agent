import { confirmAction } from '../../components/confirm-dialog.js';
import { toast } from '../../components/toast.js';
import { markUnsaved } from '../../interaction-safety.js';
import { getRouteParams, replaceRouteParams } from '../../router.js';
import { esc } from '../../utils.js';

let activeState = null;
let monacoPromise = null;

export async function mountCode(container, data = {}) {
  disposeActiveState();
  const root = document.createElement('div');
  root.className = 'section code-page';
  root.dataset.unsavedChanges = 'false';
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
    fileSha: '',
    fileWritable: false,
    savedContent: '',
    dirty: false,
    mode: 'edit',
    monaco: null,
    editor: null,
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
  // Live task updates may refresh metadata and file lists, but they must never
  // recreate the active editor while the user is typing.
  void refreshWorkspace(state, { refreshCurrent: false, quiet: true });
  return true;
}

function bindShell(state) {
  const taskSelect = state.root.querySelector('[data-code-task]');
  const search = state.root.querySelector('[data-code-search]');
  const refresh = state.root.querySelector('[data-code-refresh]');
  const save = state.root.querySelector('[data-code-save]');
  const editMode = state.root.querySelector('[data-code-mode="edit"]');
  const diffMode = state.root.querySelector('[data-code-mode="diff"]');
  const openIde = state.root.querySelector('[data-code-open-ide]');

  taskSelect.addEventListener('change', async () => {
    if (!await confirmDiscard(state)) {
      taskSelect.value = state.taskId;
      return;
    }
    await switchTask(state, taskSelect.value, { updateRoute: true });
  });
  search.addEventListener('input', () => renderFiles(state));
  refresh.addEventListener('click', () => refreshWorkspace(state, { refreshCurrent: !state.dirty }));
  save.addEventListener('click', () => saveCurrentFile(state));
  editMode.addEventListener('click', () => setMode(state, 'edit'));
  diffMode.addEventListener('click', () => setMode(state, 'diff'));
  openIde.addEventListener('click', () => openInIde(state));
  window.addEventListener('pagehide', disposeActiveState, { once: true });
}

async function switchTask(state, taskId, options = {}) {
  state.taskId = String(taskId || '').trim();
  state.workspace = null;
  state.filePath = '';
  state.fileSha = '';
  state.savedContent = '';
  setDirty(state, false);
  disposeEditor(state);
  setEditorMessage(state, 'Loading task files…');
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
    if (state.filePath && !state.dirty && !changedFiles.includes(state.filePath)) {
      state.filePath = '';
      state.fileSha = '';
      state.savedContent = '';
      renderFileHeading(state, '');
      setEditorMessage(state, 'This task has no changed text file selected.');
    }
    renderWorkspaceMeta(state);
    renderFiles(state);
    if (options.refreshCurrent && state.filePath && !state.dirty) {
      await openFile(state, state.filePath, { preserveSelection: true, quiet: options.quiet });
      return;
    }
    if (!state.filePath) {
      const first = changedFiles[0] || '';
      if (first) await openFile(state, first, { quiet: options.quiet });
      else setEditorMessage(state, 'This task has no changed text files to display.');
    }
  } catch (error) {
    if (!options.quiet) toast(messageFor(error), { variant: 'error' });
    renderWorkspaceError(state, error);
  }
}

function renderWorkspaceMeta(state) {
  const workspace = state.workspace || {};
  const meta = state.root.querySelector('[data-code-meta]');
  const save = state.root.querySelector('[data-code-save]');
  const diff = state.root.querySelector('[data-code-mode="diff"]');
  if (meta) {
    const parts = [workspace.workspace || 'Project'];
    if (workspace.workspaceMode) parts.push(workspace.workspaceMode === 'isolated' ? 'Isolated task' : 'Visible project');
    if (workspace.integrationStatus && workspace.integrationStatus !== 'not_applicable') parts.push(`Integration: ${workspace.integrationStatus}`);
    meta.textContent = parts.join(' · ');
  }
  if (save) save.disabled = workspace.writable !== true || state.fileWritable !== true || state.mode !== 'edit' || !state.filePath;
  if (diff) diff.disabled = !state.filePath;
}

function changedTextFiles(workspace = {}) {
  const available = new Set(workspace.files || []);
  return [...new Set(workspace.changedFiles || [])].filter(file => available.has(file));
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
    list.innerHTML = `<div class="code-file-empty">${query ? 'No matching changed files.' : 'No changed files yet.'}</div>`;
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
      if (!await confirmDiscard(state)) return;
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
    state.fileSha = file.sha256 || '';
    state.fileWritable = file.writable === true;
    state.savedContent = file.content || '';
    setDirty(state, false);
    renderFiles(state);
    renderFileHeading(state, path);
    await renderEditor(state, file, options);
  } catch (error) {
    state.filePath = previous;
    if (!options.quiet) toast(messageFor(error), { variant: 'error' });
    setEditorMessage(state, messageFor(error), 'error');
  }
}

async function renderEditor(state, file, options = {}) {
  const host = state.root.querySelector('[data-code-editor]');
  if (!host) return;
  disposeEditor(state);
  host.classList.remove('code-editor-message');
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
      readOnly: state.mode === 'diff' || state.workspace?.writable !== true || file.writable !== true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: state.mode === 'diff',
      useInlineViewWhenSpaceIsLimited: true,
      renderIndicators: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      fontLigatures: true
    });
    state.diffEditor.setModel({ original, modified });
    state.editor = state.diffEditor.getModifiedEditor();
    if (state.mode === 'edit') {
      state.editor.onDidChangeModelContent(() => {
        setDirty(state, state.editor.getValue() !== state.savedContent);
      });
      state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveCurrentFile(state); });
    }
    if (!options.preserveSelection) state.editor.focus();
  } catch (error) {
    renderTextFallback(state, file, error);
  }
  renderWorkspaceMeta(state);
}

function renderTextFallback(state, file, error) {
  const host = state.root.querySelector('[data-code-editor]');
  host.innerHTML = '';
  const textarea = document.createElement('textarea');
  textarea.className = 'code-text-fallback';
  textarea.value = file.content || '';
  textarea.readOnly = state.mode === 'diff' || state.workspace?.writable !== true;
  textarea.setAttribute('aria-label', state.filePath || 'Code editor');
  textarea.addEventListener('input', () => {
    state.editor = textarea;
    setDirty(state, textarea.value !== state.savedContent);
  });
  state.editor = textarea;
  host.appendChild(textarea);
  toast(`Monaco could not start. A plain text editor is available. ${messageFor(error)}`, { variant: 'warn' });
}

async function saveCurrentFile(state) {
  if (!state.filePath || state.mode !== 'edit' || state.workspace?.writable !== true) return;
  const content = editorValue(state);
  const button = state.root.querySelector('[data-code-save]');
  button.disabled = true;
  try {
    const result = await state.bridge.write(state.taskId, state.filePath, content, state.fileSha);
    state.fileSha = result.sha256 || state.fileSha;
    state.savedContent = content;
    setDirty(state, false);
    toast(result.changed === false ? 'File is already saved.' : 'File saved to this task.', { variant: 'success' });
    await refreshWorkspace(state, { refreshCurrent: false, quiet: true });
    window.dispatchEvent(new CustomEvent('relai:dashboard-refresh', { detail: { structural: false } }));
  } catch (error) {
    toast(messageFor(error), { variant: 'error' });
  } finally {
    renderWorkspaceMeta(state);
  }
}

async function setMode(state, mode) {
  if (mode === state.mode) return;
  if (mode === 'diff' && !await confirmDiscard(state)) return;
  state.mode = mode;
  state.root.querySelectorAll('[data-code-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.codeMode === mode);
    button.setAttribute('aria-pressed', button.dataset.codeMode === mode ? 'true' : 'false');
  });
  if (state.filePath) await openFile(state, state.filePath);
  renderWorkspaceMeta(state);
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

function setDirty(state, dirty) {
  state.dirty = dirty === true;
  markUnsaved(state.root, state.dirty);
  const marker = state.root.querySelector('[data-code-dirty]');
  if (marker) marker.textContent = state.dirty ? 'Unsaved changes' : 'Saved';
  const save = state.root.querySelector('[data-code-save]');
  if (save) save.disabled = !state.dirty || state.mode !== 'edit' || state.workspace?.writable !== true || state.fileWritable !== true;
}

async function confirmDiscard(state) {
  if (!state.dirty) return true;
  const confirmed = await confirmAction({
    title: 'Discard editor changes?',
    message: 'Discard the unsaved changes in this file?',
    detail: 'The project will keep the last saved version.',
    confirmLabel: 'Discard changes',
    danger: true
  });
  if (confirmed) setDirty(state, false);
  return confirmed;
}

function renderFileHeading(state, path) {
  const heading = state.root.querySelector('[data-code-file-heading]');
  if (heading) heading.textContent = path;
}

function setEditorMessage(state, message, tone = '') {
  const host = state.root.querySelector('[data-code-editor]');
  if (!host) return;
  disposeEditor(state);
  host.className = `code-editor-host code-editor-message${tone ? ` ${tone}` : ''}`;
  host.textContent = message;
}

function renderWorkspaceError(state, error) {
  state.workspace = null;
  state.root.querySelector('[data-code-files]').innerHTML = '<div class="code-file-empty">Task files are unavailable.</div>';
  setEditorMessage(state, messageFor(error), 'error');
  const meta = state.root.querySelector('[data-code-meta]');
  if (meta) meta.textContent = 'Task workspace unavailable';
}

function syncTaskOptions(state, tasks) {
  const select = state.root.querySelector('[data-code-task]');
  if (!select) return;
  const current = select.value;
  select.innerHTML = taskOptionsHtml(tasks);
  if (tasks.some(task => task.id === current)) select.value = current;
}

function editorValue(state) {
  if (!state.editor) return state.savedContent;
  if (typeof state.editor.getValue === 'function') return state.editor.getValue();
  return String(state.editor.value || '');
}

function disposeEditor(state) {
  if (state.diffEditor) {
    try { state.diffEditor.dispose?.(); } catch {}
  } else {
    try { state.editor?.dispose?.(); } catch {}
  }
  state.diffEditor = null;
  state.editor = null;
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
    <div class="code-workspace-meta" data-code-meta>Loading project files…</div>
    <div class="code-workbench">
      <aside class="code-explorer" aria-label="Changed task files">
        <div class="code-explorer-head">
          <strong>Changed files</strong>
          <input type="search" data-code-search placeholder="Filter changed files" aria-label="Filter changed task files">
        </div>
        <div class="code-file-list" data-code-files><div class="code-file-empty">Loading files…</div></div>
      </aside>
      <section class="code-editor-pane">
        <div class="code-editor-toolbar">
          <div class="code-file-heading mono" data-code-file-heading>No file selected</div>
          <div class="code-editor-actions">
            <div class="segmented" role="group" aria-label="Code view">
              <button class="active" type="button" data-code-mode="edit" aria-pressed="true">Editor</button>
              <button type="button" data-code-mode="diff" aria-pressed="false">Diff</button>
            </div>
            <span class="code-save-state" data-code-dirty>Saved</span>
            <button class="primary" type="button" data-code-save disabled>Save</button>
          </div>
        </div>
        <div class="code-editor-host code-editor-message" data-code-editor>Choose a file to view its code.</div>
      </section>
    </div>`;
}

function desktopOnlyHtml() {
  return '<div class="dashboard-state"><div class="dashboard-state-card"><span class="status-pill warn">Desktop feature</span><h2>Open Code in the Rel.AI desktop app.</h2><p>The browser dashboard cannot access task files or local IDEs.</p></div></div>';
}

function emptyHtml() {
  return '<div class="dashboard-state"><div class="dashboard-state-card"><h2>No task code is available.</h2><p>Start a Rel.AI task, then return here to review its files.</p><div class="dashboard-state-actions"><a class="buttonlike primary" href="#tasks">Open tasks</a></div></div></div>';
}

function messageFor(error) {
  return error instanceof Error ? error.message : String(error || 'The code workspace request failed.');
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
