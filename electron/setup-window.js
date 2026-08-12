import { fitWindowToContent, WINDOW_SIZE_LIMITS } from './window-size.js';
import { installLocalProtocol, localRendererUrl } from './local-protocol.js';
import { localWindowWebPreferences, secureLocalWindow } from './window-security.js';
import { STARTUP_BACKGROUND_COLOR } from './startup-background.js';

function createSetupWindowManager(deps) {
  const { BrowserWindow, preloadPath, rendererRoot, runtimeLogs, isQuitting, recoveryWindowManager } = deps;
  let window = null;
  let recoveryMode = false;
  let returnToFallback = false;

  function create(options = {}) {
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
      return window;
    }
    recoveryMode = options.recovery === true;
    returnToFallback = recoveryMode;
    const rendererUrl = localRendererUrl('wizard.html', recoveryMode ? { recovery: '1' } : {});
    window = new BrowserWindow({
      width: WINDOW_SIZE_LIMITS.wizard.minWidth,
      height: 620,
      minWidth: WINDOW_SIZE_LIMITS.wizard.minWidth,
      minHeight: WINDOW_SIZE_LIMITS.wizard.minHeight,
      resizable: true,
      maximizable: true,
      useContentSize: true,
      webPreferences: localWindowWebPreferences(preloadPath, 'relai-setup', 'application'),
      backgroundColor: STARTUP_BACKGROUND_COLOR,
      title: recoveryMode ? 'Rel.AI MCP - Connection Recovery' : 'Rel.AI MCP - Setup',
      autoHideMenuBar: true
    });
    installLocalProtocol(window.webContents.session.protocol, rendererRoot);
    secureLocalWindow(window, {
      allowedUrl: rendererUrl,
      onError: error => runtimeLogs.append(error.message, { level: 'warning', source: 'electron-security' })
    });
    void window.loadURL(rendererUrl).catch(error => {
      runtimeLogs.append(`Setup renderer failed to load: ${formatError(error)}`, { level: 'error', source: 'electron-renderer' });
    });
    window.webContents.on('did-finish-load', () => fitWindowToContent(window, { type: 'wizard' }));
    window.on('closed', () => reset());
    return window;
  }

  function close(options = {}) {
    returnToFallback = options.returnToFallback === true && recoveryMode;
    if (window && !window.isDestroyed()) window.destroy();
    else reset();
  }

  function reset() {
    const shouldReturn = returnToFallback;
    window = null;
    recoveryMode = false;
    returnToFallback = false;
    if (shouldReturn && !isQuitting()) recoveryWindowManager.show();
  }

  function getWindow() {
    return window && !window.isDestroyed() ? window : null;
  }

  return { create, close, getWindow };
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export { createSetupWindowManager };
