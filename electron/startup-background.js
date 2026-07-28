// BrowserWindow owns this pre-render canvas color. It prevents Electron's default
// white flash before renderer CSS is available without coupling runtime code to the
// build-time color-token manifest.
const STARTUP_BACKGROUND_COLOR = '#1f2937';

export { STARTUP_BACKGROUND_COLOR };
