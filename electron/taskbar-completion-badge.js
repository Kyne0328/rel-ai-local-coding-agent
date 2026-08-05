import { deflateSync } from 'node:zlib';

const MAX_BADGE_COUNT = 99;
const MAX_SEEN_TASKS = 256;
const BADGE_SIZE = 16;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const DIGIT_BITMAPS = Object.freeze({
  0: ['11111', '10001', '10011', '10101', '11001', '10001', '11111'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['11110', '00001', '00001', '11110', '10000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['10010', '10010', '10010', '11111', '00010', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01111', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '11110']
});

function createTaskbarCompletionBadge(options = {}) {
  const {
    app,
    nativeImage,
    platform = process.platform,
    getWindow = () => null,
    isApplicationOpen = () => false
  } = options;
  const usesWindowOverlay = platform === 'win32';
  const usesApplicationBadge = (platform === 'linux' || platform === 'darwin')
    && typeof app?.setBadgeCount === 'function';
  if (usesWindowOverlay && (!nativeImage || typeof nativeImage.createFromBuffer !== 'function')) {
    throw new TypeError('Electron nativeImage with PNG buffer support is required for Windows taskbar badges.');
  }

  let count = 0;
  const seenTaskIds = new Set();
  const seenOrder = [];
  const knownWindows = new Set();

  function markCompleted(task = {}) {
    const taskId = String(task.taskId || task.work_id || task.id || '').trim();
    if (taskId && seenTaskIds.has(taskId)) return snapshot();
    if (taskId) remember(taskId);
    if (isApplicationOpen()) {
      clear();
      return snapshot();
    }
    count = Math.min(MAX_BADGE_COUNT, count + 1);
    apply();
    return snapshot();
  }

  function clear() {
    count = 0;
    if (usesApplicationBadge) applyApplicationBadge();
    if (!usesWindowOverlay) return snapshot();
    const primary = getWindow();
    if (primary) knownWindows.add(primary);
    for (const win of [...knownWindows]) {
      if (!win || win.isDestroyed?.()) {
        knownWindows.delete(win);
        continue;
      }
      applyWindowOverlay(win);
    }
    return snapshot();
  }

  function apply(windowOverride) {
    if (usesApplicationBadge) return applyApplicationBadge();
    if (!usesWindowOverlay) return false;
    return applyWindowOverlay(windowOverride || getWindow());
  }

  function applyApplicationBadge() {
    try {
      return app.setBadgeCount(count) !== false;
    } catch {
      return false;
    }
  }

  function applyWindowOverlay(win) {
    if (!win || win.isDestroyed?.() || typeof win.setOverlayIcon !== 'function') return false;
    knownWindows.add(win);
    if (count === 0) {
      win.setOverlayIcon(null, '');
      return true;
    }
    const image = createBadgeImage(nativeImage, count);
    if (!image || image.isEmpty?.()) return false;
    win.setOverlayIcon(image, `${count} completed ${count === 1 ? 'task' : 'tasks'} waiting to be viewed`);
    return true;
  }

  function remember(taskId) {
    seenTaskIds.add(taskId);
    seenOrder.push(taskId);
    while (seenOrder.length > MAX_SEEN_TASKS) {
      seenTaskIds.delete(seenOrder.shift());
    }
  }

  function snapshot() {
    return {
      count,
      visible: count > 0,
      supported: usesWindowOverlay || usesApplicationBadge
    };
  }

  return { apply, clear, getStatus: snapshot, markCompleted };
}

function createBadgeImage(nativeImage, count) {
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') {
    throw new TypeError('Electron nativeImage with PNG buffer support is required.');
  }
  const image = nativeImage.createFromBuffer(createBadgePng(count));
  return typeof image.resize === 'function'
    ? image.resize({ width: BADGE_SIZE, height: BADGE_SIZE, quality: 'best' })
    : image;
}

function createBadgePng(count) {
  const label = String(Math.min(MAX_BADGE_COUNT, Math.max(1, Number(count) || 1)));
  const pixels = Buffer.alloc(BADGE_SIZE * BADGE_SIZE * 4);
  drawCircle(pixels);
  drawLabel(pixels, label);
  const scanlines = Buffer.alloc((BADGE_SIZE * 4 + 1) * BADGE_SIZE);
  for (let y = 0; y < BADGE_SIZE; y += 1) {
    const rowStart = y * (BADGE_SIZE * 4 + 1);
    scanlines[rowStart] = 0;
    pixels.copy(scanlines, rowStart + 1, y * BADGE_SIZE * 4, (y + 1) * BADGE_SIZE * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(BADGE_SIZE, 0);
  header.writeUInt32BE(BADGE_SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function drawCircle(pixels) {
  for (let y = 0; y < BADGE_SIZE; y += 1) {
    for (let x = 0; x < BADGE_SIZE; x += 1) {
      const distance = Math.hypot(x + 0.5 - BADGE_SIZE / 2, y + 0.5 - BADGE_SIZE / 2);
      if (distance > 7.5) continue;
      setPixel(pixels, x, y, distance > 6.4 ? [255, 255, 255, 255] : [19, 122, 76, 255]);
    }
  }
}

function drawLabel(pixels, label) {
  const glyphWidth = 5;
  const glyphHeight = 7;
  const spacing = 1;
  const totalWidth = label.length * glyphWidth + (label.length - 1) * spacing;
  const startX = Math.floor((BADGE_SIZE - totalWidth) / 2);
  const startY = Math.floor((BADGE_SIZE - glyphHeight) / 2);
  for (let index = 0; index < label.length; index += 1) {
    const glyph = DIGIT_BITMAPS[label[index]];
    for (let y = 0; y < glyphHeight; y += 1) {
      for (let x = 0; x < glyphWidth; x += 1) {
        if (glyph[y][x] === '1') setPixel(pixels, startX + index * (glyphWidth + spacing) + x, startY + y, [255, 255, 255, 255]);
      }
    }
  }
}

function setPixel(pixels, x, y, rgba) {
  if (x < 0 || x >= BADGE_SIZE || y < 0 || y >= BADGE_SIZE) return;
  const offset = (y * BADGE_SIZE + x) * 4;
  pixels[offset] = rgba[0];
  pixels[offset + 1] = rgba[1];
  pixels[offset + 2] = rgba[2];
  pixels[offset + 3] = rgba[3];
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export { MAX_BADGE_COUNT, createBadgeImage, createTaskbarCompletionBadge };
