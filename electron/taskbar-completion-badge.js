import { deflateSync } from 'node:zlib';

const MAX_BADGE_COUNT = 99;
const MAX_SEEN_TASKS = 256;
const BADGE_SIZE = 16;
const BADGE_VISIBLE_COUNT_LIMIT = 9;
const BADGE_SCALE_FACTORS = Object.freeze([1, 1.25, 1.5, 1.75, 2, 2.5, 3]);
const BADGE_BACKGROUND_COLOR = Object.freeze([242, 63, 66, 255]);
const BADGE_TEXT_COLOR = Object.freeze([255, 255, 255, 255]);
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
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '11110'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000']
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
  const badgeImages = new Map();

  function markCompleted(task = {}) {
    const taskId = String(task.taskId || task.work_id || task.id || '').trim();
    if (taskId && seenTaskIds.has(taskId)) return snapshot();
    if (taskId) remember(taskId);
    if (isApplicationOpen()) {
      clear();
      return snapshot();
    }
    if (count >= MAX_BADGE_COUNT) return snapshot();
    count += 1;
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
      clearWindowOverlay(win);
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

  function clearWindowOverlay(win) {
    if (!win || win.isDestroyed?.() || typeof win.setOverlayIcon !== 'function') return false;
    knownWindows.add(win);
    win.setOverlayIcon(null, '');
    return true;
  }

  function applyWindowOverlay(win) {
    if (!win || win.isDestroyed?.() || typeof win.setOverlayIcon !== 'function') return false;
    knownWindows.add(win);
    if (count === 0) return clearWindowOverlay(win);
    const image = badgeImage(count);
    if (!image || image.isEmpty?.()) return false;
    const noun = count === 1 ? 'task' : 'tasks';
    win.setOverlayIcon(image, String(count) + ' completed ' + noun + ' waiting to be viewed');
    return true;
  }

  function badgeImage(unreadCount) {
    const key = unreadCount > BADGE_VISIBLE_COUNT_LIMIT ? BADGE_VISIBLE_COUNT_LIMIT + 1 : unreadCount;
    if (!badgeImages.has(key)) badgeImages.set(key, createBadgeImage(nativeImage, unreadCount));
    return badgeImages.get(key);
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
  const image = nativeImage.createFromBuffer(createBadgePng(count, BADGE_SIZE), { scaleFactor: 1 });
  if (typeof image.addRepresentation !== 'function') return image;
  for (const scaleFactor of BADGE_SCALE_FACTORS.slice(1)) {
    image.addRepresentation({
      scaleFactor,
      buffer: createBadgePng(count, Math.round(BADGE_SIZE * scaleFactor))
    });
  }
  return image;
}

function createBadgePng(count, size = BADGE_SIZE) {
  const pixelSize = Math.max(BADGE_SIZE, Math.round(Number(size) || BADGE_SIZE));
  const normalizedCount = Math.min(MAX_BADGE_COUNT, Math.max(1, Number(count) || 1));
  const label = normalizedCount > BADGE_VISIBLE_COUNT_LIMIT ? `${BADGE_VISIBLE_COUNT_LIMIT}+` : String(normalizedCount);
  const pixels = Buffer.alloc(pixelSize * pixelSize * 4);
  drawBadgeBackground(pixels, pixelSize);
  drawLabel(pixels, label, pixelSize);
  const scanlines = Buffer.alloc((pixelSize * 4 + 1) * pixelSize);
  for (let y = 0; y < pixelSize; y += 1) {
    const rowStart = y * (pixelSize * 4 + 1);
    scanlines[rowStart] = 0;
    pixels.copy(scanlines, rowStart + 1, y * pixelSize * 4, (y + 1) * pixelSize * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(pixelSize, 0);
  header.writeUInt32BE(pixelSize, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
function drawBadgeBackground(pixels, size) {
  const representationScale = size / BADGE_SIZE;
  const center = (size - 1) / 2;
  const radius = 7.25 * representationScale;
  const edgeWidth = Math.max(1, representationScale);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const coverage = Math.max(0, Math.min(1, (radius + edgeWidth / 2 - distance) / edgeWidth));
      if (coverage > 0) blendPixel(pixels, size, x, y, BADGE_BACKGROUND_COLOR, coverage);
    }
  }
}

function drawLabel(pixels, label, size) {
  const representationScale = size / BADGE_SIZE;
  const glyphWidth = 5;
  const glyphHeight = 7;
  const spacing = 1;
  const pixelScale = representationScale;
  const totalWidth = (label.length * glyphWidth + (label.length - 1) * spacing) * pixelScale;
  const totalHeight = glyphHeight * pixelScale;
  const startX = Math.round((size - totalWidth) / 2);
  const startY = Math.round((size - totalHeight) / 2 - 0.25 * representationScale);

  drawGlyphs(pixels, label, size, {
    glyphWidth,
    glyphHeight,
    spacing,
    pixelScale,
    startX,
    startY,
    color: BADGE_TEXT_COLOR
  });
}

function drawGlyphs(pixels, label, size, options) {
  const { glyphWidth, glyphHeight, spacing, pixelScale, startX, startY, color } = options;
  for (let index = 0; index < label.length; index += 1) {
    const glyph = DIGIT_BITMAPS[label[index]];
    for (let y = 0; y < glyphHeight; y += 1) {
      for (let x = 0; x < glyphWidth; x += 1) {
        if (glyph[y][x] !== '1') continue;
        fillLogicalPixel(
          pixels,
          size,
          startX + (index * (glyphWidth + spacing) + x) * pixelScale,
          startY + y * pixelScale,
          pixelScale,
          color
        );
      }
    }
  }
}

function fillLogicalPixel(pixels, size, x, y, scale, rgba) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(size, Math.ceil(x + scale));
  const bottom = Math.min(size, Math.ceil(y + scale));
  for (let pixelY = top; pixelY < bottom; pixelY += 1) {
    const coverageY = Math.max(0, Math.min(pixelY + 1, y + scale) - Math.max(pixelY, y));
    for (let pixelX = left; pixelX < right; pixelX += 1) {
      const coverageX = Math.max(0, Math.min(pixelX + 1, x + scale) - Math.max(pixelX, x));
      blendPixel(pixels, size, pixelX, pixelY, rgba, coverageX * coverageY);
    }
  }
}

function blendPixel(pixels, size, x, y, rgba, coverage = 1) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const offset = (y * size + x) * 4;
  const sourceAlpha = (rgba[3] / 255) * Math.max(0, Math.min(1, coverage));
  const destinationAlpha = pixels[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const source = rgba[channel] / 255;
    const destination = pixels[offset + channel] / 255;
    const output = (source * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha)) / outputAlpha;
    pixels[offset + channel] = Math.round(output * 255);
  }
  pixels[offset + 3] = Math.round(outputAlpha * 255);
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
