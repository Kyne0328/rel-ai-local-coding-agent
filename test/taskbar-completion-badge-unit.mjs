import assert from 'node:assert/strict';

import { MAX_BADGE_COUNT, createBadgeImage, createTaskbarCompletionBadge } from '../electron/taskbar-completion-badge.js';

const overlays = [];
const images = [];
let applicationOpen = false;
const win = {
  destroyed: false,
  isDestroyed() { return this.destroyed; },
  setOverlayIcon(image, description) { overlays.push({ image, description }); }
};
const nativeImage = {
  createFromDataURL(dataUrl) {
    const image = {
      dataUrl,
      resize(options) { this.resizeOptions = options; return this; }
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
assert.match(decodeURIComponent(images.at(-1).dataUrl), />1<\/text>/);
assert.deepEqual(images.at(-1).resizeOptions, { width: 16, height: 16, quality: 'best' });

badge.markCompleted({ taskId: 'task-1' });
assert.equal(badge.getStatus().count, 1, 'duplicate completion must not increase unread count');
badge.markCompleted({ taskId: 'task-2' });
assert.equal(badge.getStatus().count, 2);
assert.match(decodeURIComponent(images.at(-1).dataUrl), />2<\/text>/);

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
assert.match(decodeURIComponent(images.at(-1).dataUrl), />99<\/text>/);

const direct = createBadgeImage(nativeImage, 7);
assert.ok(direct);
const unsupported = createTaskbarCompletionBadge({ nativeImage, platform: 'linux', getWindow: () => win });
unsupported.markCompleted({ taskId: 'linux-task' });
assert.deepEqual(unsupported.getStatus(), { count: 1, visible: true, supported: false });
assert.equal(unsupported.apply(), false);

console.log('Windows taskbar completion badge count, deduplication, visibility, and clearing tests passed.');
