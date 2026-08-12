import assert from 'node:assert/strict';

import { MAX_BADGE_COUNT, createBadgeImage, createTaskbarCompletionBadge } from '../electron/taskbar-completion-badge.js';

const overlays = [];
const images = [];
const badgeBuffers = [];
const badgeRepresentations = [];
let legacyDataUrlCalls = 0;
let applicationOpen = false;
const win = {
  destroyed: false,
  isDestroyed() { return this.destroyed; },
  setOverlayIcon(image, description) { overlays.push({ image, description }); }
};
const nativeImage = {
  createFromDataURL(dataUrl) {
    legacyDataUrlCalls += 1;
    return {
      dataUrl,
      isEmpty() { return true; },
      resize(options) { this.resizeOptions = options; return this; }
    };
  },
  createFromBuffer(buffer) {
    badgeBuffers.push(buffer);
    const image = {
      buffer,
      isEmpty() { return false; },
      addRepresentation(options) { badgeRepresentations.push(options); }
    };
    images.push(image);
    return image;
  }
};
const badge = createTaskbarCompletionBadge({
  nativeImage,
  platform: 'win32',
  getWindow: () => win,
  isApplicationOpen: () => applicationOpen
});

assert.deepEqual(badge.getStatus(), { count: 0, visible: false, supported: true });
badge.markCompleted({ taskId: 'task-1' });
assert.equal(badge.getStatus().count, 1);
assert.equal(overlays.at(-1).description, '1 completed task waiting to be viewed');
assert.ok(overlays.at(-1).image);
assert.equal(overlays.at(-1).image.isEmpty(), false, 'Windows must receive a decodable overlay image');
assert.equal(legacyDataUrlCalls, 0, 'Electron badge overlays must use a supported PNG buffer, not an SVG data URL');
assert.equal(badgeBuffers.length, 1);
assert.deepEqual([...badgeBuffers[0].subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(badgeRepresentations.length, 6, 'Windows badge must include high-DPI representations instead of stretching one 16px raster');
assert.deepEqual(badgeRepresentations.map(item => item.scaleFactor), [1.25, 1.5, 1.75, 2, 2.5, 3]);
assert.deepEqual(badgeRepresentations.map(item => item.buffer.readUInt32BE(16)), [20, 24, 28, 32, 40, 48]);

badge.markCompleted({ taskId: 'task-1' });
assert.equal(badge.getStatus().count, 1, 'duplicate completion must not increase unread count');
badge.markCompleted({ taskId: 'task-2' });
assert.equal(badge.getStatus().count, 2);
assert.notEqual(Buffer.compare(badgeBuffers[0], badgeBuffers.at(-1)), 0, 'different counts must render different badge images');

badge.clear();
assert.equal(badge.getStatus().count, 0);
assert.equal(overlays.at(-1).image, null);
assert.equal(overlays.at(-1).description, '');
badge.markCompleted({ taskId: 'task-2' });
assert.equal(badge.getStatus().count, 0, 'a duplicate event must not recreate a cleared badge');

applicationOpen = true;
badge.markCompleted({ taskId: 'task-3' });
assert.equal(badge.getStatus().count, 0, 'visible focused application work is not unread');
applicationOpen = false;
for (let index = 4; index < 120; index += 1) badge.markCompleted({ taskId: `task-${index}` });
assert.equal(badge.getStatus().count, MAX_BADGE_COUNT);
assert.notEqual(Buffer.compare(badgeBuffers[0], badgeBuffers.at(-1)), 0, 'the capped count must still render its numeric badge');
const rendersAtCap = badgeBuffers.length;
badge.markCompleted({ taskId: 'task-over-cap' });
assert.equal(badgeBuffers.length, rendersAtCap, 'additional completions at the 99 cap must not regenerate an identical overlay');

const direct = createBadgeImage(nativeImage, 7);
assert.ok(direct);
assert.equal(direct.isEmpty(), false);

const repeated = createBadgeImage(nativeImage, 7);
assert.equal(Buffer.compare(direct.buffer, repeated.buffer), 0, 'the same unread count must render a stable taskbar badge image');

const linuxBadgeCounts = [];
const linuxBadge = createTaskbarCompletionBadge({
  app: {
    setBadgeCount(count) {
      linuxBadgeCounts.push(count);
      return true;
    }
  },
  nativeImage,
  platform: 'linux',
  getWindow: () => win
});
linuxBadge.markCompleted({ taskId: 'linux-task' });
assert.deepEqual(linuxBadge.getStatus(), { count: 1, visible: true, supported: true });
assert.deepEqual(linuxBadgeCounts, [1], 'Linux launcher badge must receive the unread count');
linuxBadge.clear();
assert.deepEqual(linuxBadge.getStatus(), { count: 0, visible: false, supported: true });
assert.deepEqual(linuxBadgeCounts, [1, 0], 'opening the app must explicitly clear the Linux launcher badge');

console.log('Cross-platform task completion badge count, rendering, deduplication, and clearing tests passed.');
