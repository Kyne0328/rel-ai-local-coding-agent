import { screen } from "electron";

const centeredWindows = new WeakSet();

const WINDOW_SIZE_LIMITS = {
  wizard: {
    minWidth: 480,
    maxWidth: 720,
    minHeight: 420,
    maxHeight: 900,
    paddingWidth: 24,
    paddingHeight: 24
  },
  status: {
    minWidth: 440,
    maxWidth: 760,
    minHeight: 500,
    maxHeight: 940,
    paddingWidth: 20,
    paddingHeight: 20
  }
};

function fitWindowToContent(win, options = {}) {
  if (!win || win.isDestroyed()) return;

  const type = options.type === 'wizard' ? 'wizard' : 'status';
  const limits = WINDOW_SIZE_LIMITS[type];
  const display = screen.getDisplayMatching(win.getBounds());
  const maxDisplayWidth = Math.max(limits.minWidth, (display?.workAreaSize?.width || limits.maxWidth) - 80);
  const maxDisplayHeight = Math.max(limits.minHeight, (display?.workAreaSize?.height || limits.maxHeight) - 80);

  const requestedWidth = Number.isFinite(options.width) ? options.width : win.getContentBounds().width;
  const requestedHeight = Number.isFinite(options.height) ? options.height : win.getContentBounds().height;

  const width = Math.max(
    limits.minWidth,
    Math.min(Math.ceil(requestedWidth + limits.paddingWidth), limits.maxWidth, maxDisplayWidth)
  );
  const height = Math.max(
    limits.minHeight,
    Math.min(Math.ceil(requestedHeight + limits.paddingHeight), limits.maxHeight, maxDisplayHeight)
  );

  const currentBounds = win.getContentBounds();
  if (currentBounds.width === width && currentBounds.height === height) return;

  const bounds = win.getBounds();
  win.setContentSize(width, height, true);
  if (!centeredWindows.has(win)) {
    win.center();
    centeredWindows.add(win);
  } else {
    win.setPosition(bounds.x, bounds.y, false);
  }
}

export { fitWindowToContent, WINDOW_SIZE_LIMITS };
