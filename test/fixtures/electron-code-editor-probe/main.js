const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const targetUrl = process.env.RELAI_PROBE_TARGET_URL;
const outputPath = process.env.RELAI_PROBE_OUTPUT_PATH;

if (!targetUrl || !outputPath) throw new Error('Code editor probe requires RELAI_PROBE_TARGET_URL and RELAI_PROBE_OUTPUT_PATH.');

app.whenReady().then(async () => {
  const cspErrors = [];
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.webContents.on('console-message', (_event, _level, message) => {
    if (/content security policy|refused to apply inline style/i.test(String(message || ''))) cspErrors.push(String(message));
  });

  try {
    await win.loadURL(targetUrl);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      history.replaceState(null, '', '#code?task=probe-task');
      const host = document.createElement('div');
      document.body.replaceChildren(host);
      const module = await import('/public/ui/features/code/index.js');
      const data = { tasks: [{ work_id: 'probe-task', title: 'Changes viewer probe', status: 'running', workspace: 'app' }] };
      await module.mountCode(host, data);
      for (let attempt = 0; attempt < 50 && !document.querySelector('.monaco-editor .view-lines'); attempt += 1) await wait(50);
      await wait(300);
      const editorBefore = document.querySelector('.monaco-diff-editor');
      const editors = window.monaco?.editor?.getEditors?.() || [];
      const liveEditor = editors.find(editor => editor.getModel?.()?.getValue?.()?.includes('const answer = 42;')) || editors.at(-1) || null;
      const model = liveEditor?.getModel?.() || null;
      const readOnly = liveEditor?.getOption?.(window.monaco.editor.EditorOption.readOnly) === true;
      const modelLanguage = model?.getLanguageId?.() || '';
      const modelValue = model?.getValue?.() || '';
      const tokenized = typeof window.monaco?.editor?.tokenize === 'function'
        ? window.monaco.editor.tokenize(modelValue, modelLanguage)
        : [];
      const tokenTypes = [...new Set(tokenized.flatMap(line => line.map(token => token.type)).filter(Boolean))];
      const editorHtml = editorBefore?.innerHTML || '';
      const theme = document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark';
      const colorizedHtml = await window.monaco.editor.colorize(modelValue, modelLanguage, { theme });
      const colorProbe = document.createElement('div');
      colorProbe.style.position = 'fixed';
      colorProbe.style.left = '-10000px';
      colorProbe.innerHTML = colorizedHtml;
      document.body.appendChild(colorProbe);
      const tokenColors = [...new Set([...colorProbe.querySelectorAll('span')]
        .map(token => getComputedStyle(token).color)
        .filter(Boolean))];
      colorProbe.remove();
      const lineHeight = liveEditor?.getOption?.(window.monaco.editor.EditorOption.lineHeight) || 0;
      const lineTops = liveEditor
        ? Array.from({ length: Math.min(5, model?.getLineCount?.() || 0) }, (_, index) => liveEditor.getTopForLineNumber(index + 1))
        : [];
      liveEditor?.setPosition?.({ lineNumber: 3, column: 10 });
      const positionBeforeLiveUpdate = liveEditor?.getPosition?.() || null;
      const rectFor = selector => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? { width: box.width, height: box.height, top: box.top, left: box.left } : null;
      };
      module.updateCodeLiveState(host, data);
      await wait(150);
      const positionAfterLiveUpdate = liveEditor?.getPosition?.() || null;
      return {
        editorPresent: Boolean(editorBefore),
        inlineDiffEditor: Boolean(document.querySelector('.monaco-diff-editor')),
        readOnly,
        saveButtonPresent: Boolean(document.querySelector('[data-code-save]')),
        changedFileRows: [...document.querySelectorAll('[data-code-file]')].map(button => button.dataset.codeFile || ''),
        statusBadges: [...document.querySelectorAll('[data-code-file]')].map(button => {
          const marker = button.querySelector('.code-file-marker');
          const style = marker ? getComputedStyle(marker) : null;
          const box = marker?.getBoundingClientRect?.();
          return {
            path: button.dataset.codeFile || '',
            code: marker?.textContent?.trim() || '',
            title: button.getAttribute('title') || '',
            fontSize: style ? Number.parseFloat(style.fontSize) : 0,
            width: box?.width || 0,
            height: box?.height || 0
          };
        }),
        sameEditorAfterLiveUpdate: editorBefore === document.querySelector('.monaco-diff-editor'),
        modelLanguage,
        modelValue,
        tokenTypes,
        tokenColors,
        lineHeight,
        lineTops,
        positionBeforeLiveUpdate,
        positionAfterLiveUpdate,
        editorHtmlSample: editorHtml.slice(0, 1000),
        geometry: {
          host: rectFor('[data-code-editor]'),
          pane: rectFor('.code-editor-pane'),
          workbench: rectFor('.code-workbench'),
          monaco: rectFor('.monaco-editor:not(.gutter)')
        }
      };
    })()`);
    result.cspErrors = cspErrors;
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  } catch (error) {
    fs.writeFileSync(outputPath, JSON.stringify({ error: error instanceof Error ? error.stack || error.message : String(error), cspErrors }, null, 2));
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.exit(process.exitCode || 0);
  }
});
