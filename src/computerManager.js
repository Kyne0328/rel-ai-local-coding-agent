import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const COMPUTER_ACTIONS = new Set([
  'status', 'displays', 'screenshot', 'move', 'click', 'double_click', 'right_click',
  'drag', 'scroll', 'type', 'key', 'hotkey'
]);
const MODIFIER_ALIASES = Object.freeze({
  ctrl: 'control', control: 'control', shift: 'shift', alt: 'alt', option: 'alt',
  cmd: 'command', command: 'command', meta: 'command', win: 'command', super: 'command'
});
const KEY_ALIASES = Object.freeze({
  return: 'enter', esc: 'escape', spacebar: 'space', del: 'delete',
  arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right'
});
const DEFAULT_SCROLL_DISTANCE = 700;
const SCROLL_PIXELS_PER_DETENT = 100;
const MAX_SCROLL_DETENTS = 200;
const SCROLL_TICK_DELAY_MS = 30;
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const MAX_TYPE_TEXT_BYTES = 64 * 1024;
let runtimePromise = null;
let inputQueue = Promise.resolve();

function computerControlSettings(config) {
  return Object.freeze({ enabled: config?.computerControl?.enabled === true });
}

function computerControlDisabledError() {
  const error = new Error('Computer control is disabled by the local Rel.AI setting. Do not retry this computer action or request MCP approval. Ask the user to enable Computer control in Rel.AI Settings > App, then retry after the setting is enabled.');
  error.name = 'ComputerControlDisabledError';
  error.code = 'COMPUTER_CONTROL_DISABLED';
  error.source = 'rel-ai-mcp-policy';
  error.operation = 'computer_control';
  error.retryable = false;
  error.requiresUserConfirmation = false;
  error.allowedAlternatives = ['Enable Computer control in Rel.AI Settings > App, then retry the requested computer action.'];
  return error;
}

async function readComputerStatus(config, context = {}) {
  const settings = computerControlSettings(config);
  try {
    const runtime = await resolveRuntime(context);
    const size = runtime.libnut.getScreenSize();
    return {
      ok: true,
      action: 'status',
      enabled: settings.enabled,
      available: true,
      platform: process.platform,
      screen: { width: Number(size?.width || 0), height: Number(size?.height || 0) }
    };
  } catch (error) {
    return {
      ok: true,
      action: 'status',
      enabled: settings.enabled,
      available: false,
      platform: process.platform,
      message: `Computer control runtime is unavailable: ${errorMessage(error)}`
    };
  }
}

async function runComputerAction(workspace, config, args = {}, context = {}) {
  const action = String(args.action || '').trim().toLowerCase();
  if (!COMPUTER_ACTIONS.has(action)) throw new Error(`Unsupported computer action: ${action || '(missing)'}.`);
  if (action === 'status') {
    return { ...(await readComputerStatus(config, context)), workspace: workspace.alias };
  }
  if (!computerControlSettings(config).enabled) throw computerControlDisabledError();
  const runtime = await resolveRuntime(context);
  if (action === 'displays') {
    const displays = await listDisplays(runtime);
    return baseResult(workspace, action, { displays, count: displays.length });
  }
  if (action === 'screenshot') {
    const display = await resolveDisplay(runtime, args.displayId);
    const capture = await captureDisplayScreenshot(runtime, display);
    return baseResult(workspace, action, {
      display,
      image: {
        mimeType: capture.mimeType,
        data: capture.buffer.toString('base64'),
        bytes: capture.buffer.length,
        width: capture.width,
        height: capture.height
      }
    });
  }
  return queueInput(() => executeInputAction(runtime, workspace, action, args));
}

async function executeInputAction(runtime, workspace, action, args) {
  const libnut = runtime.libnut;
  const display = args.displayId ? await resolveDisplay(runtime, args.displayId) : null;
  const point = needsPoint(action) ? resolvePoint(args.x, args.y, display, 'x/y') : null;

  if (action === 'move') {
    moveMouse(libnut, point);
    return baseResult(workspace, action, pointResult(point, display));
  }
  if (action === 'click' || action === 'double_click' || action === 'right_click') {
    moveMouse(libnut, point);
    const button = action === 'right_click' ? 'right' : 'left';
    if (action === 'double_click') libnut.mouseClick(button, true);
    else libnut.mouseClick(button);
    return baseResult(workspace, action, { ...pointResult(point, display), executed: true });
  }
  if (action === 'drag') {
    const target = resolvePoint(args.toX, args.toY, display, 'toX/toY');
    moveMouse(libnut, point);
    libnut.mouseToggle('down', 'left');
    try {
      moveMouse(libnut, target);
    } finally {
      try { libnut.mouseToggle('up', 'left'); } catch {}
    }
    return baseResult(workspace, action, {
      ...pointResult(point, display), toX: target.localX, toY: target.localY, executed: true
    });
  }
  if (action === 'scroll') {
    if (args.x !== undefined || args.y !== undefined) {
      if (args.x === undefined || args.y === undefined) throw new Error('scroll requires both x and y when either coordinate is provided.');
      const scrollPoint = resolvePoint(args.x, args.y, display, 'x/y');
      moveMouse(libnut, scrollPoint);
    }
    const direction = String(args.direction || '').toLowerCase();
    if (!['up', 'down', 'left', 'right'].includes(direction)) throw new Error('scroll direction must be up, down, left, or right.');
    const distance = boundedInteger(args.distance, 1, 100000, DEFAULT_SCROLL_DISTANCE, 'distance');
    const detents = Math.min(MAX_SCROLL_DETENTS, Math.max(1, Math.ceil(distance / SCROLL_PIXELS_PER_DETENT)));
    const magnitude = process.platform === 'win32' ? 120 : 1;
    const [dx, dy] = scrollDelta(direction, magnitude);
    for (let index = 0; index < detents; index += 1) {
      libnut.scrollMouse(dx, dy);
      if (index < detents - 1) await delay(SCROLL_TICK_DELAY_MS);
    }
    return baseResult(workspace, action, { direction, distance, executed: true, ...(display ? { display } : {}) });
  }
  if (action === 'type') {
    const text = String(args.text ?? '');
    if (!text) throw new Error('type requires non-empty text.');
    const textBytes = Buffer.byteLength(text, 'utf8');
    if (textBytes > MAX_TYPE_TEXT_BYTES) throw new Error(`type text exceeds the ${MAX_TYPE_TEXT_BYTES}-byte limit.`);
    libnut.typeString(text);
    return baseResult(workspace, action, { executed: true, textLength: text.length });
  }
  if (action === 'key') {
    const key = normalizeKey(args.key);
    libnut.keyTap(key);
    return baseResult(workspace, action, { executed: true, key });
  }
  if (action === 'hotkey') {
    const chord = normalizeHotkey(args.keys);
    libnut.keyTap(chord.key, chord.modifiers);
    return baseResult(workspace, action, { executed: true, key: chord.key, keys: chord.keys });
  }
  throw new Error(`Unsupported computer input action: ${action}.`);
}

function baseResult(workspace, action, extra = {}) {
  return { ok: true, workspace: workspace.alias, action, platform: process.platform, ...extra };
}

function needsPoint(action) {
  return ['move', 'click', 'double_click', 'right_click', 'drag'].includes(action);
}

function moveMouse(libnut, point) {
  libnut.moveMouse(point.globalX, point.globalY);
}

function pointResult(point, display) {
  return { x: point.localX, y: point.localY, ...(display ? { display } : {}) };
}

function resolvePoint(xValue, yValue, display, label) {
  const x = boundedInteger(xValue, -100000, 100000, null, `${label} x`);
  const y = boundedInteger(yValue, -100000, 100000, null, `${label} y`);
  if (display) {
    if (!hasDisplayGeometry(display)) {
      throw new Error(`Display '${display.id}' does not expose usable desktop geometry. Use absolute virtual-desktop coordinates without displayId.`);
    }
    if (x < 0 || y < 0 || x >= display.width || y >= display.height) {
      throw new Error(`${label} must be inside display '${display.id}' (${display.width}x${display.height}).`);
    }
    return { localX: x, localY: y, globalX: display.left + x, globalY: display.top + y };
  }
  return { localX: x, localY: y, globalX: x, globalY: y };
}

async function listDisplays(runtime) {
  const raw = await runtime.screenshot.listDisplays();
  const displays = (Array.isArray(raw) ? raw : []).map(normalizeDisplay).filter(Boolean);
  if (!displays.length) throw new Error('No desktop displays are available.');
  return displays;
}

async function resolveDisplay(runtime, requestedId) {
  const displays = await listDisplays(runtime);
  const id = String(requestedId || '').trim();
  if (id) {
    const exact = displays.find(display => display.id === id || display.name === id);
    if (!exact) throw new Error(`Unknown display '${id}'. Use relai_computer action 'displays' to list available displays.`);
    return exact;
  }
  return displays.find(display => display.primary) || displays[0];
}

function normalizeDisplay(value) {
  if (!value || typeof value !== 'object') return null;
  const rawId = value.id ?? value.name ?? '';
  const id = String(rawId).trim();
  if (!id) return null;
  const left = finiteOptionalInteger(value.left ?? value.offsetX);
  const top = finiteOptionalInteger(value.top ?? value.offsetY);
  const right = finiteOptionalInteger(value.right);
  const bottom = finiteOptionalInteger(value.bottom);
  const width = positiveOptionalInteger(value.width, left != null && right != null ? right - left : null);
  const height = positiveOptionalInteger(value.height, top != null && bottom != null ? bottom - top : null);
  const geometryAvailable = left != null && top != null && width != null && height != null;
  const dpiScale = Number(value.dpiScale);
  const display = {
    id,
    name: String(value.name ?? id),
    primary: typeof value.primary === 'boolean' ? value.primary : geometryAvailable && left === 0 && top === 0,
    coordinateSpace: geometryAvailable ? 'display-local-pixels' : 'display-local-unavailable',
    ...(geometryAvailable ? { left, top, width, height } : {}),
    ...(Number.isFinite(dpiScale) && dpiScale > 0 ? { dpiScale } : {})
  };
  Object.defineProperty(display, 'captureId', { value: rawId, enumerable: false });
  return display;
}

function hasDisplayGeometry(display) {
  return Number.isFinite(display?.left) && Number.isFinite(display?.top)
    && Number.isFinite(display?.width) && display.width > 0
    && Number.isFinite(display?.height) && display.height > 0;
}

async function captureDisplayScreenshot(runtime, display) {
  const screen = display?.captureId ?? display?.id;
  const png = requireImageBuffer(await runtime.screenshot({ screen, format: 'png' }));
  const size = pngSize(png);
  const width = size.width || display?.width || 0;
  const height = size.height || display?.height || 0;
  if (png.length <= MAX_SCREENSHOT_BYTES) {
    return { buffer: png, mimeType: 'image/png', width, height };
  }
  const jpeg = requireImageBuffer(await runtime.screenshot({ screen, format: 'jpg' }));
  if (jpeg.length > MAX_SCREENSHOT_BYTES) {
    throw new Error(`Computer screenshot exceeds the ${MAX_SCREENSHOT_BYTES}-byte image limit even after JPEG fallback.`);
  }
  return { buffer: jpeg, mimeType: 'image/jpeg', width, height };
}

function requireImageBuffer(value) {
  if (!Buffer.isBuffer(value)) throw new Error('Computer screenshot runtime did not return image bytes.');
  return value;
}

function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return { width: 0, height: 0 };
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) return { width: 0, height: 0 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function normalizeKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) throw new Error('key requires a key name.');
  if (Object.hasOwn(MODIFIER_ALIASES, key)) throw new Error('Use hotkey for modifier chords.');
  return KEY_ALIASES[key] || key;
}

function normalizeHotkey(value) {
  if (!Array.isArray(value) || value.length < 2) throw new Error('hotkey requires at least one modifier and one key.');
  const raw = value.map(item => String(item || '').trim().toLowerCase()).filter(Boolean);
  if (raw.length < 2) throw new Error('hotkey requires at least one modifier and one key.');
  const key = normalizeKey(raw.at(-1));
  const modifiers = raw.slice(0, -1).map(item => MODIFIER_ALIASES[item]);
  if (modifiers.some(item => !item)) throw new Error('hotkey modifiers must be ctrl/control, shift, alt/option, or cmd/command/meta/win/super.');
  return { key, modifiers, keys: [...modifiers, key] };
}

function scrollDelta(direction, amount) {
  if (direction === 'up') return [0, amount];
  if (direction === 'down') return [0, -amount];
  if (direction === 'left') return [-amount, 0];
  return [amount, 0];
}

function boundedInteger(value, min, max, fallback, label) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== null) return fallback;
    throw new Error(`${label} is required.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`);
  const integer = Math.round(number);
  if (integer < min || integer > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return integer;
}

function finiteOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function positiveOptionalInteger(value, fallback = null) {
  const direct = finiteOptionalInteger(value);
  const resolved = direct == null ? finiteOptionalInteger(fallback) : direct;
  return resolved != null && resolved > 0 ? resolved : null;
}

function queueInput(operation) {
  const run = inputQueue.then(operation, operation);
  inputQueue = run.catch(() => {});
  return run;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveRuntime(context = {}) {
  if (context?.computerRuntime?.libnut && context?.computerRuntime?.screenshot) return context.computerRuntime;
  if (!runtimePromise) {
    runtimePromise = Promise.all([
      import('screenshot-desktop'),
      Promise.resolve().then(() => require('@nut-tree-fork/libnut/dist/import_libnut'))
    ]).then(([screenshotModule, libnutModule]) => {
      const screenshot = screenshotModule.default || screenshotModule;
      const libnut = libnutModule.libnut;
      if (typeof screenshot !== 'function' || typeof screenshot.listDisplays !== 'function') throw new Error('screenshot-desktop did not expose the expected API.');
      if (!libnut || typeof libnut.moveMouse !== 'function' || typeof libnut.keyTap !== 'function') throw new Error('libnut did not expose the expected input API.');
      return { screenshot, libnut };
    }).catch(error => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

export { computerControlSettings, readComputerStatus, runComputerAction };
