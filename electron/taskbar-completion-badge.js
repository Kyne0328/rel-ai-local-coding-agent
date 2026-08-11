import { deflateSync } from 'node:zlib';

const MAX_BADGE_COUNT = 99;
const MAX_SEEN_TASKS = 256;
const BADGE_SIZE = 16;
const BADGE_SCALE_FACTORS = Object.freeze([1, 1.25, 1.5, 1.75, 2, 2.5, 3]);
const FALLBACK_BADGE_COLOR = Object.freeze([23, 105, 194, 255]);
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
    isApplicationOpen = () => false,
    getBadgeColor = () => FALLBACK_BADGE_COLOR
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
    const image = createBadgeImage(nativeImage, count, currentBadgeColor());
    if (!image || image.isEmpty?.()) return false;
    const noun = count === 1 ? 'task' : 'tasks';
    win.setOverlayIcon(image, String(count) + ' completed ' + noun + ' waiting to be viewed');
    return true;
  }
  function currentBadgeColor() {
    try {
      return normalizeBadgeColor(getBadgeColor());
    } catch {
      return [...FALLBACK_BADGE_COLOR];
    }
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

function createBadgeImage(nativeImage, count, badgeColor = FALLBACK_BADGE_COLOR) {
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') {
    throw new TypeError('Electron nativeImage with PNG buffer support is required.');
  }
  const image = nativeImage.createFromBuffer(createBadgePng(count, BADGE_SIZE, badgeColor), { scaleFactor: 1 });
  if (typeof image.addRepresentation !== 'function') return image;
  for (const scaleFactor of BADGE_SCALE_FACTORS.slice(1)) {
    image.addRepresentation({
      scaleFactor,
      buffer: createBadgePng(count, Math.round(BADGE_SIZE * scaleFactor), badgeColor)
    });
  }
  return image;
}

function createBadgePng(count, size = BADGE_SIZE, badgeColor = FALLBACK_BADGE_COLOR) {
  const pixelSize = Math.max(BADGE_SIZE, Math.round(Number(size) || BADGE_SIZE));
  const label = String(Math.min(MAX_BADGE_COUNT, Math.max(1, Number(count) || 1)));
  const background = normalizeBadgeColor(badgeColor);
  const foreground = badgeTextColor(background);
  const pixels = Buffer.alloc(pixelSize * pixelSize * 4);
  drawCircle(pixels, pixelSize, background);
  drawLabel(pixels, label, pixelSize, foreground);
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

function drawCircle(pixels, size, color) {
  const scale = size / BADGE_SIZE;
  const center = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center) / scale;
      const coverage = Math.min(1, 7.5 - distance);
      if (coverage <= 0) continue;
      setPixel(pixels, size, x, y, [
        color[0],
        color[1],
        color[2],
        Math.round(color[3] * coverage)
      ]);
    }
  }
}
function drawLabel(pixels, label, size, color) {
  const scale = size / BADGE_SIZE;
  const glyphWidth = 5;
  const glyphHeight = 7;
  const spacing = 1;
  const totalWidth = label.length * glyphWidth + (label.length - 1) * spacing;
  const startX = (BADGE_SIZE - totalWidth) / 2;
  const startY = (BADGE_SIZE - glyphHeight) / 2;
  for (let index = 0; index < label.length; index += 1) {
    const glyph = DIGIT_BITMAPS[label[index]];
    for (let y = 0; y < glyphHeight; y += 1) {
      for (let x = 0; x < glyphWidth; x += 1) {
        if (glyph[y][x] !== '1') continue;
        fillLogicalPixel(
          pixels,
          size,
          (startX + index * (glyphWidth + spacing) + x) * scale,
          (startY + y) * scale,
          scale,
          color
        );
      }
    }
  }
}

function normalizeBadgeColor(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return [
      clampColor(value[0]),
      clampColor(value[1]),
      clampColor(value[2]),
      value.length > 3 ? clampColor(value[3]) : 255
    ];
  }
  const hex = String(value || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(hex)) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255
    ];
  }
  return [...FALLBACK_BADGE_COLOR];
}

function badgeTextColor(background) {
  const [red, green, blue] = normalizeBadgeColor(background);
  const luminance = relativeLuminance(red, green, blue);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return blackContrast >= whiteContrast ? [0, 0, 0, 255] : [255, 255, 255, 255];
}

function relativeLuminance(red, green, blue) {
  const linear = value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function fillLogicalPixel(pixels, size, x, y, scale, rgba) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(size, Math.ceil(x + scale));
  const bottom = Math.min(size, Math.ceil(y + scale));
  for (let pixelY = top; pixelY < bottom; pixelY += 1) {
    for (let pixelX = left; pixelX < right; pixelX += 1) setPixel(pixels, size, pixelX, pixelY, rgba);
  }
}

function setPixel(pixels, size, x, y, rgba) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const offset = (y * size + x) * 4;
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

export { MAX_BADGE_COUNT, badgeTextColor, createBadgeImage, createTaskbarCompletionBadge, normalizeBadgeColor };
