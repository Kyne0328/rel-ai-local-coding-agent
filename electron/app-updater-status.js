function normalizeStatus(value) {
  const state = String(value.state || 'idle');
  const supported = value.supported === true;
  const availableVersion = cleanVersion(value.availableVersion);
  const installMode = value.installMode === 'open_dmg' ? 'open_dmg' : 'restart';
  return {
    state,
    supported,
    installMode,
    supportReason: cleanText(value.supportReason, 300),
    currentVersion: cleanVersion(value.currentVersion),
    availableVersion,
    releaseDate: cleanText(value.releaseDate, 80),
    releaseNotes: normalizeReleaseNotes(value.releaseNotes, availableVersion),
    checkedAt: cleanText(value.checkedAt, 80),
    downloadedAt: cleanText(value.downloadedAt, 80),
    progress: value.progress ? progressPayload(value.progress) : null,
    errorCode: cleanText(value.errorCode, 120),
    error: cleanText(value.error, 600),
    integrityVerified: value.integrityVerified === true,
    updateSynchronization: normalizeUpdateSynchronization(value.updateSynchronization),
    availableCompatibility: normalizeUpdateCompatibility(value.availableCompatibility),
    canCheck: supported && !['checking', 'downloading', 'installing'].includes(state),
    canDownload: supported && state === 'available',
    canInstall: supported && state === 'downloaded' && value.integrityVerified === true
  };
}

function updateCompatibilityMetadata(info = {}, applicationVersion = '') {
  const raw = info?.relai || info?.relAi || info?.relaiCompatibility;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = {
    applicationVersion: cleanVersion(applicationVersion || info?.version),
    schemaVersion: Number(raw.schemaVersion),
    manifestHash: cleanText(raw.manifestHash, 200),
    deviceProtocolVersion: Number(raw.deviceProtocolVersion),
    minimumCompatibleDeviceProtocol: Number(raw.minimumCompatibleDeviceProtocol)
  };
  if (!value.applicationVersion || !Number.isInteger(value.schemaVersion) || value.schemaVersion <= 0 || !value.manifestHash) return null;
  if (!Number.isInteger(value.deviceProtocolVersion) || value.deviceProtocolVersion <= 0) return null;
  if (!Number.isInteger(value.minimumCompatibleDeviceProtocol) || value.minimumCompatibleDeviceProtocol <= 0) return null;
  return value;
}

function normalizeUpdateCompatibility(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return updateCompatibilityMetadata({ relai: value, version: value.applicationVersion }, value.applicationVersion);
}

function normalizeUpdateSynchronization(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = String(value.status || '');
  if (!['current', 'tool_refresh_required', 'device_update_required'].includes(status)) return null;
  return {
    status,
    toolRefreshRequired: value.toolRefreshRequired === true,
    deviceUpdateRequired: value.deviceUpdateRequired === true
  };
}

function assessUpdateSynchronization(current = {}, available = {}) {
  const schemaChanged = Number(current.schemaVersion || 0) !== Number(available.schemaVersion || 0)
    || String(current.manifestHash || '') !== String(available.manifestHash || '');
  const deviceChanged = Number(current.deviceProtocolVersion || 0) !== Number(available.deviceProtocolVersion || 0)
    || Number(current.minimumCompatibleDeviceProtocol || 0) !== Number(available.minimumCompatibleDeviceProtocol || 0);
  return {
    status: deviceChanged ? 'device_update_required' : schemaChanged ? 'tool_refresh_required' : 'current',
    toolRefreshRequired: schemaChanged,
    deviceUpdateRequired: deviceChanged
  };
}

function progressPayload(value = {}) {
  return {
    percent: clampNumber(value.percent, 0, 100),
    transferred: nonNegativeNumber(value.transferred),
    total: nonNegativeNumber(value.total),
    bytesPerSecond: nonNegativeNumber(value.bytesPerSecond)
  };
}

function clampNumber(value, minimum, maximum) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(number * 10) / 10));
}

function nonNegativeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function cleanVersion(value) {
  return cleanText(value, 80).replace(/^v/i, '');
}

function normalizeReleaseNotes(value, fallbackVersion = '') {
  const entries = Array.isArray(value) ? value : value ? [{ version: fallbackVersion, note: value }] : [];
  return entries.slice(0, 12).map(entry => {
    if (typeof entry === 'string') return { version: cleanVersion(fallbackVersion), note: cleanReleaseNoteText(entry, 6000) };
    return {
      version: cleanVersion(entry?.version || fallbackVersion),
      note: cleanReleaseNoteText(entry?.note, 6000)
    };
  }).filter(entry => entry.note);
}

function cleanReleaseNoteText(value, limit) {
  const text = String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\t\f\v]+/g, ' ').replace(/ +/g, ' ').trimEnd())
    .join('\n')
    .trim();
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function cleanText(value, limit) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export { assessUpdateSynchronization, cleanText, normalizeStatus, progressPayload, updateCompatibilityMetadata };
