

import { packageMetadata as pkg } from './packageMetadata.js';
import { getVersion } from "./version.js";

function githubUsername(profileUrl) {
  try {
    const url = new URL(String(profileUrl || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password) return '';
    return url.pathname.split('/').filter(Boolean)[0] || '';
  } catch {
    return '';
  }
}

function repositoryUrl(repository) {
  const value = typeof repository === 'string' ? repository : repository?.url;
  return String(value || '').replace(/^git\+/, '').replace(/\.git$/, '');
}

function getApplicationMetadata() {
  const profileUrl = String(pkg.author?.url || '');
  return {
    name: String(pkg.productName || pkg.name || ''),
    version: getVersion(),
    developer: {
      name: String(pkg.author?.name || ''),
      username: githubUsername(profileUrl),
      profileUrl
    },
    repositoryUrl: repositoryUrl(pkg.repository),
    license: String(pkg.license || '')
  };
}

export { getApplicationMetadata };
