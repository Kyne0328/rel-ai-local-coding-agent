'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';

const LOCAL_SCHEME = 'relai-app';
const LOCAL_HOST = 'renderer';
const installedProtocols = new WeakSet();
const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png'
});

function registerLocalScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{
    scheme: LOCAL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true
    }
  }]);
}

function installLocalProtocol(protocol, rendererRoot) {
  if (!protocol || typeof protocol.handle !== 'function') {
    throw new TypeError('An Electron protocol handler is required.');
  }
  if (installedProtocols.has(protocol)) return false;
  const root = path.resolve(rendererRoot);
  protocol.handle(LOCAL_SCHEME, request => {
    const target = resolveLocalRendererPath(request.url, root);
    if (!target) return new Response('Not found', { status: 404 });
    try {
      const contentType = CONTENT_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
      return new Response(fs.readFileSync(target), {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff'
        }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  installedProtocols.add(protocol);
  return true;
}

function localRendererUrl(fileName, query = {}) {
  const safeName = path.posix.basename(String(fileName || ''));
  if (!safeName || safeName !== String(fileName || '').replaceAll('\\', '/')) {
    throw new Error('Local renderer URL must reference a renderer file name.');
  }
  const url = new URL(`${LOCAL_SCHEME}://${LOCAL_HOST}/${encodeURIComponent(safeName)}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  return url.href;
}

function resolveLocalRendererPath(target, rendererRoot) {
  try {
    const url = new URL(String(target || ''));
    if (url.protocol !== `${LOCAL_SCHEME}:` || url.hostname !== LOCAL_HOST || url.username || url.password || url.port) return '';
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relative || relative.includes('/') || relative.includes('\\') || relative.includes('\0')) return '';
    const extension = path.extname(relative).toLowerCase();
    if (!Object.hasOwn(CONTENT_TYPES, extension)) return '';
    const root = path.resolve(rendererRoot);
    const absolute = path.resolve(root, relative);
    if (path.dirname(absolute) !== root || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return '';
    return absolute;
  } catch {
    return '';
  }
}

export {  installLocalProtocol, localRendererUrl, registerLocalScheme, resolveLocalRendererPath };
