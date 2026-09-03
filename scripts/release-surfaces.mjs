const VERSION_JSON_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'electron/package.json',
  'electron/package-lock.json'
]);

const RELEASE_CHANGE_FILES = Object.freeze([
  ...VERSION_JSON_FILES,
  'release-manifest.json',
  'CHANGELOG.md',
  'electron/renderer/status.html'
]);

function isReleaseChangeFile(relativePath) {
  return RELEASE_CHANGE_FILES.includes(String(relativePath || '').replaceAll('\\', '/'));
}

export { RELEASE_CHANGE_FILES, VERSION_JSON_FILES, isReleaseChangeFile };
