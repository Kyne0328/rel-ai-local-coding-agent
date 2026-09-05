import assert from 'node:assert/strict';

import { readComputerStatus, runComputerAction } from '../src/computerManager.js';
import { getToolActionCatalog } from '../src/tools/actionCatalog.js';
import { serializeToolError } from '../src/tools/errors.js';

const workspace = { alias: 'repo' };
const enabledConfig = { computerControl: { enabled: true } };
const disabledConfig = { computerControl: { enabled: false } };
const calls = [];
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const MAX_TYPE_TEXT_BYTES = 64 * 1024;

const libnut = {
  getScreenSize: () => ({ width: 1920, height: 1080 }),
  moveMouse: (x, y) => calls.push(['moveMouse', x, y]),
  mouseClick: (...args) => calls.push(['mouseClick', ...args]),
  mouseToggle: (...args) => calls.push(['mouseToggle', ...args]),
  scrollMouse: (...args) => calls.push(['scrollMouse', ...args]),
  typeString: text => calls.push(['typeString', text]),
  keyTap: (...args) => calls.push(['keyTap', ...args])
};

function pngBuffer(width, height, bytes = 24) {
  const buffer = Buffer.alloc(Math.max(24, bytes));
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const png = pngBuffer(1280, 1024);
const screenshot = async options => {
  calls.push(['screenshot', options]);
  return png;
};
screenshot.listDisplays = async () => [
  { id: 'display-side', name: 'Side', left: -1280, top: 0, width: 1280, height: 1024, dpiScale: 1.25 },
  { id: 'display-main', name: 'Main', left: 0, top: 0, width: 1920, height: 1080, dpiScale: 1 }
];
const context = { computerRuntime: { libnut, screenshot } };

const disabledStatus = await readComputerStatus(disabledConfig, context);
assert.equal(disabledStatus.ok, true);
assert.equal(disabledStatus.enabled, false);
assert.equal(disabledStatus.available, true);
assert.deepEqual(disabledStatus.screen, { width: 1920, height: 1080 });

await assert.rejects(
  () => runComputerAction(workspace, disabledConfig, { action: 'screenshot' }, context),
  error => {
    assert.equal(error.code, 'COMPUTER_CONTROL_DISABLED');
    assert.equal(error.retryable, false);
    assert.equal(error.requiresUserConfirmation, false);
    assert.match(error.message, /Do not retry this computer action or request MCP approval/i);
    const serialized = serializeToolError('relai_computer', error);
    assert.equal(serialized.errorCode, 'COMPUTER_CONTROL_DISABLED');
    assert.equal(serialized.errorDetails.retryable, false);
    assert.equal(serialized.errorDetails.requiresUserConfirmation, false);
    assert.deepEqual(serialized.errorDetails.allowedAlternatives, [
      'Enable Computer control in Rel.AI Settings > App, then retry the requested computer action.'
    ]);
    return true;
  }
);

const displays = await runComputerAction(workspace, enabledConfig, { action: 'displays' }, context);
assert.equal(displays.count, 2);
assert.equal(displays.displays[0].primary, false);
assert.equal(displays.displays[0].coordinateSpace, 'display-local-pixels');
assert.equal(displays.displays[0].dpiScale, 1.25);
assert.equal(displays.displays[1].primary, true);

const capture = await runComputerAction(workspace, enabledConfig, {
  action: 'screenshot', displayId: 'display-side'
}, context);
assert.equal(capture.display.id, 'display-side');
assert.equal(capture.image.mimeType, 'image/png');
assert.equal(capture.image.width, 1280);
assert.equal(capture.image.height, 1024);
assert.equal(capture.image.data, png.toString('base64'));
assert.deepEqual(calls.at(-1), ['screenshot', { screen: 'display-side', format: 'png' }]);

calls.length = 0;
await runComputerAction(workspace, enabledConfig, {
  action: 'click', displayId: 'display-side', x: 100, y: 50
}, context);
assert.deepEqual(calls, [
  ['moveMouse', -1180, 50],
  ['mouseClick', 'left']
]);

const linuxCalls = [];
const linuxScreenshot = async () => pngBuffer(800, 600);
linuxScreenshot.listDisplays = async () => [
  { id: 'HDMI-2', name: 'HDMI-2', offsetX: 1920, offsetY: 100, width: 800, height: 600, primary: false }
];
await runComputerAction(workspace, enabledConfig, {
  action: 'click', displayId: 'HDMI-2', x: 10, y: 20
}, { computerRuntime: { screenshot: linuxScreenshot, libnut: { ...libnut, moveMouse: (x, y) => linuxCalls.push(['moveMouse', x, y]), mouseClick: (...args) => linuxCalls.push(['mouseClick', ...args]) } } });
assert.deepEqual(linuxCalls, [['moveMouse', 1930, 120], ['mouseClick', 'left']], 'Linux offsetX/offsetY must map display-local pixels to virtual-desktop coordinates.');

const macCalls = [];
const macScreenshot = async options => {
  macCalls.push(options);
  return pngBuffer(2560, 1600);
};
macScreenshot.listDisplays = async () => [{ id: 0, name: 'Color LCD', primary: true }];
const macContext = { computerRuntime: { screenshot: macScreenshot, libnut } };
const macCapture = await runComputerAction(workspace, enabledConfig, { action: 'screenshot', displayId: '0' }, macContext);
assert.equal(macCapture.image.width, 2560);
assert.equal(macCapture.image.height, 1600);
assert.deepEqual(macCalls.at(-1), { screen: 0, format: 'png' }, 'Numeric display IDs must preserve the provider-native capture identifier.');
await assert.rejects(
  () => runComputerAction(workspace, enabledConfig, { action: 'click', displayId: '0', x: 10, y: 20 }, macContext),
  /does not expose usable desktop geometry/
);

const fallbackCalls = [];
const fallbackScreenshot = async options => {
  fallbackCalls.push(options);
  return options.format === 'png'
    ? pngBuffer(3840, 2160, MAX_SCREENSHOT_BYTES + 1)
    : Buffer.alloc(1024);
};
fallbackScreenshot.listDisplays = async () => [{ id: 'large', left: 0, top: 0, width: 3840, height: 2160, primary: true }];
const boundedCapture = await runComputerAction(workspace, enabledConfig, { action: 'screenshot', displayId: 'large' }, {
  computerRuntime: { screenshot: fallbackScreenshot, libnut }
});
assert.equal(boundedCapture.image.mimeType, 'image/jpeg');
assert.equal(boundedCapture.image.bytes, 1024);
assert.equal(boundedCapture.image.width, 3840);
assert.equal(boundedCapture.image.height, 2160);
assert.deepEqual(fallbackCalls.map(item => item.format), ['png', 'jpg']);

const oversizedScreenshot = async options => options.format === 'png'
  ? pngBuffer(3840, 2160, MAX_SCREENSHOT_BYTES + 1)
  : Buffer.alloc(MAX_SCREENSHOT_BYTES + 1);
oversizedScreenshot.listDisplays = fallbackScreenshot.listDisplays;
await assert.rejects(
  () => runComputerAction(workspace, enabledConfig, { action: 'screenshot', displayId: 'large' }, {
    computerRuntime: { screenshot: oversizedScreenshot, libnut }
  }),
  /4194304-byte image limit/
);

calls.length = 0;
await runComputerAction(workspace, enabledConfig, { action: 'scroll', direction: 'down', distance: 1 }, context);
assert.deepEqual(calls, [['scrollMouse', 0, process.platform === 'win32' ? -120 : -1]]);

calls.length = 0;
await runComputerAction(workspace, enabledConfig, { action: 'type', text: 'hello' }, context);
await runComputerAction(workspace, enabledConfig, { action: 'key', key: 'enter' }, context);
await runComputerAction(workspace, enabledConfig, { action: 'hotkey', keys: ['ctrl', 's'] }, context);
assert.deepEqual(calls, [
  ['typeString', 'hello'],
  ['keyTap', 'enter'],
  ['keyTap', 's', ['control']]
]);

calls.length = 0;
await assert.rejects(
  () => runComputerAction(workspace, enabledConfig, { action: 'type', text: 'x'.repeat(MAX_TYPE_TEXT_BYTES + 1) }, context),
  /65536-byte limit/
);
assert.equal(calls.some(item => item[0] === 'typeString'), false, 'oversized typing must be rejected before native input execution');
const typeAction = getToolActionCatalog().find(entry => entry.publicTool === 'relai_computer' && entry.action === 'type');
assert.equal(typeAction?.inputSchema?.properties?.text?.maxLength, 65536, 'the model-facing schema must advertise the bounded typing limit');

await assert.rejects(
  () => runComputerAction(workspace, enabledConfig, {
    action: 'click', displayId: 'display-side', x: 1280, y: 20
  }, context),
  /must be inside display/
);

const dragCalls = [];
let moveCount = 0;
const dragRuntime = {
  screenshot,
  libnut: {
    ...libnut,
    moveMouse: (x, y) => {
      dragCalls.push(['moveMouse', x, y]);
      moveCount += 1;
      if (moveCount === 2) throw new Error('target move failed');
    },
    mouseToggle: (...args) => dragCalls.push(['mouseToggle', ...args])
  }
};
await assert.rejects(
  () => runComputerAction(workspace, enabledConfig, {
    action: 'drag', x: 10, y: 20, toX: 30, toY: 40
  }, { computerRuntime: dragRuntime }),
  /target move failed/
);
assert.deepEqual(dragCalls.at(-1), ['mouseToggle', 'up', 'left'], 'drag failure must always release the mouse button');

console.log('Computer manager enforces opt-in control, bounded screenshots and typing, provider-safe display IDs, platform display geometry, input primitives, and safe drag release.');
