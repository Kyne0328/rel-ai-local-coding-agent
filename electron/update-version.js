'use strict';

function parseStableVersion(value) {
  const version = String(value || '').trim();
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function isStableVersion(value) {
  return Boolean(parseStableVersion(value));
}

function compareVersions(left, right) {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  if (!leftParts || !rightParts) return Number.NaN;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

module.exports = { compareVersions, isStableVersion, parseStableVersion };
