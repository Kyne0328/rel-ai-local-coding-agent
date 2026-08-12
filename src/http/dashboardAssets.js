import * as fs from 'node:fs';

const STATIC_ASSET_CACHE = new Map();

function readCachedStaticAsset(filePath) {
  const stat = fs.statSync(filePath);
  const signature = `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  const cached = STATIC_ASSET_CACHE.get(filePath);
  if (cached?.signature === signature) return cached.content;
  const content = fs.readFileSync(filePath);
  STATIC_ASSET_CACHE.set(filePath, { signature, content });
  if (STATIC_ASSET_CACHE.size > 128) STATIC_ASSET_CACHE.delete(STATIC_ASSET_CACHE.keys().next().value);
  return content;
}

export { readCachedStaticAsset };
