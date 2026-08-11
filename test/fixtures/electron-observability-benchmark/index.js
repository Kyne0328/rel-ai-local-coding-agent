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
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body><main id="app"></main></body></html>'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const app = document.getElementById('app');
      let fullRenders = 0;
      const routeObserver = new MutationObserver(records => {
        for (const record of records) {
          if (record.target === app && record.type === 'childList') fullRenders += 1;
        }
      });
      routeObserver.observe(app, { childList: true, subtree: false });

      const sessions = document.createElement('section');
      sessions.className = 'session-list';
      const sessionRows = [];
      const liveClocks = [];
      for (let index = 0; index < 52; index += 1) {
        const row = document.createElement('article');
        row.className = 'session-row';
        row.dataset.taskId = 'task-' + index;
        row.dataset.sessionFingerprint = 'stable-' + index;
        const title = document.createElement('strong');
        title.textContent = index < 2 ? 'Open work session ' + index : 'Completed work session ' + index;
        const progress = document.createElement('output');
        progress.className = 'session-progress';
        progress.textContent = '0';
        const time = document.createElement('span');
        time.className = 'session-time';
        time.textContent = index < 2 ? '0s' : (index + 1) + 'm';
        if (index < 2) liveClocks.push(time);
        row.append(title, progress, time);
        sessions.append(row);
        sessionRows.push(row);
      }
      app.replaceChildren(sessions);
      await new Promise(resolve => requestAnimationFrame(resolve));
      fullRenders = 0;

      let quietClockNodeUpdates = 0;
      for (let tick = 1; tick <= 60; tick += 1) {
        for (const clock of liveClocks) {
          clock.textContent = tick + 's';
          quietClockNodeUpdates += 1;
        }
      }
      await new Promise(resolve => requestAnimationFrame(resolve));
      const quietFullRenders = fullRenders;

      let sessionRowReplacementsDuringProgress = 0;
      const sessionObserver = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && node.matches?.('.session-row')) sessionRowReplacementsDuringProgress += 1;
          }
        }
      });
      sessionObserver.observe(sessions, { childList: true, subtree: false });
      fullRenders = 0;
      const progress = sessionRows[0].querySelector('.session-progress');
      const progressStart = performance.now();
      for (let index = 0; index < 100; index += 1) progress.textContent = String(index + 1);
      const progressLatencyMs = performance.now() - progressStart;
      await new Promise(resolve => requestAnimationFrame(resolve));
      const progressFullRenders = fullRenders;
      sessionObserver.disconnect();

      const timelineStart = performance.now();
      const timeline = document.createElement('ol');
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < 200; index += 1) {
        const row = document.createElement('li');
        row.textContent = 'Tool activity ' + index + ' completed with validation metadata and a work-session identity.';
        fragment.append(row);
      }
      timeline.append(fragment);
      app.replaceChildren(timeline);
      const timelineRenderMs = performance.now() - timelineStart;

      const heapBefore = performance.memory?.usedJSHeapSize || 0;
      for (let task = 0; task < 40; task += 1) {
        const panel = document.createElement('section');
        const panelFragment = document.createDocumentFragment();
        for (let index = 0; index < 100; index += 1) {
          const row = document.createElement('div');
          row.textContent = 'Logical task ' + task + ' event ' + index;
          panelFragment.append(row);
        }
        panel.append(panelFragment);
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
      routeObserver.disconnect();
      return {
        quietFullRenders,
        quietClockNodeUpdates,
        progressFullRenders,
        sessionRowReplacementsDuringProgress,
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
