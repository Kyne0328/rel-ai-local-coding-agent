import { app, BrowserWindow } from 'electron';

app.commandLine.appendSwitch('enable-precise-memory-info');
app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true
    }
  });
  try {
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body><main id="app"></main><span id="clock"></span></body></html>'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const app = document.getElementById('app');
      const clock = document.getElementById('clock');
      let fullRenders = 0;
      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.target === document.body && record.type === 'childList') fullRenders += 1;
        }
      });
      observer.observe(document.body, { childList: true, subtree: false });

      for (let index = 0; index < 60; index += 1) clock.textContent = String(index);
      await new Promise(resolve => requestAnimationFrame(resolve));
      const quietFullRenders = fullRenders;

      const progress = document.createElement('output');
      app.replaceChildren(progress);
      fullRenders = 0;
      const progressStart = performance.now();
      for (let index = 0; index < 100; index += 1) progress.textContent = String(index + 1);
      const progressLatencyMs = performance.now() - progressStart;
      await new Promise(resolve => requestAnimationFrame(resolve));
      const progressFullRenders = fullRenders;

      const timelineStart = performance.now();
      const timeline = document.createElement('ol');
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < 200; index += 1) {
        const row = document.createElement('li');
        row.textContent = 'Tool activity ' + index + ' completed with validation metadata and a long logical task identifier.';
        fragment.append(row);
      }
      timeline.append(fragment);
      app.replaceChildren(timeline);
      const timelineRenderMs = performance.now() - timelineStart;

      const heapBefore = performance.memory?.usedJSHeapSize || 0;
      for (let task = 0; task < 40; task += 1) {
        const panel = document.createElement('section');
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < 100; index += 1) {
          const row = document.createElement('div');
          row.textContent = 'Logical task ' + task + ' event ' + index;
          fragment.append(row);
        }
        panel.append(fragment);
        app.replaceChildren(panel);
      }
      const heapAfter = performance.memory?.usedJSHeapSize || heapBefore;

      const timerStart = performance.now();
      await new Promise(resolve => setTimeout(resolve, 100));
      const hiddenTimerElapsedMs = performance.now() - timerStart;

      const reconnectStart = performance.now();
      const snapshot = document.createDocumentFragment();
      for (let index = 0; index < 500; index += 1) {
        const row = document.createElement('article');
        row.dataset.taskId = 'task-' + index;
        row.textContent = 'Current logical task state ' + index;
        snapshot.append(row);
      }
      app.replaceChildren(snapshot);
      const reconnectMs = performance.now() - reconnectStart;
      observer.disconnect();
      return {
        quietFullRenders,
        progressFullRenders,
        progressLatencyMs,
        timelineRenderMs,
        logicalTaskSwitchMemoryDeltaBytes: Math.max(0, heapAfter - heapBefore),
        hiddenTimerElapsedMs,
        reconnectMs
      };
    })()`, true);
    console.log('REL_AI_RENDERER_BENCHMARK_RESULT=' + Buffer.from(JSON.stringify(result)).toString('base64'));
  } catch (error) {
    console.error('REL_AI_RENDERER_BENCHMARK_ERROR=' + Buffer.from(String(error?.stack || error)).toString('base64'));
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
