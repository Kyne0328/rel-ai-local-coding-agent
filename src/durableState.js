import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

class DurableStateError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = 'DurableStateError';
    this.code = code;
    this.details = details;
  }
}

function writeTextAtomic(target, text, options = {}) {
  const file = path.resolve(String(target));
  const directory = path.dirname(file);
  const mode = options.mode ?? 0o600;
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const backup = options.backup === true ? String(options.backupPath || `${file}.bak`) : '';
  let descriptor = null;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    descriptor = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(descriptor, String(text), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;

    if (backup && fs.existsSync(file)) copyFileAtomic(file, backup, mode);
    promoteFile(temporary, file);
    syncDirectory(directory);
    return { path: file, backupPath: backup || null };
  } catch (error) {
    if (descriptor != null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw new DurableStateError(
      'DURABLE_STATE_WRITE_FAILED',
      `Could not persist state file ${path.basename(file)}.`,
      { path: file, fsCode: String(error?.code || '') },
      { cause: error }
    );
  }
}

function writeJsonAtomic(target, value, options = {}) {
  const spacing = Number.isInteger(options.spacing) ? options.spacing : 2;
  return writeTextAtomic(target, `${JSON.stringify(value, null, spacing)}\n`, options);
}

async function writeTextAtomicAsync(target, text, options = {}) {
  const file = path.resolve(String(target));
  const directory = path.dirname(file);
  const mode = options.mode ?? 0o600;
  const durable = options.durable !== false;
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const backup = options.backup === true ? String(options.backupPath || `${file}.bak`) : '';
  let handle = null;
  try {
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    handle = await fs.promises.open(temporary, 'wx', mode);
    await handle.writeFile(String(text), 'utf8');
    if (durable) await handle.sync();
    await handle.close();
    handle = null;

    if (backup && await pathExistsAsync(file)) await copyFileAtomicAsync(file, backup, mode, durable);
    await promoteFileAsync(temporary, file);
    if (durable) await syncDirectoryAsync(directory);
    return { path: file, backupPath: backup || null };
  } catch (error) {
    if (handle != null) {
      try { await handle.close(); } catch {}
    }
    try { await fs.promises.rm(temporary, { force: true }); } catch {}
    throw new DurableStateError(
      'DURABLE_STATE_WRITE_FAILED',
      `Could not persist state file ${path.basename(file)}.`,
      { path: file, fsCode: String(error?.code || '') },
      { cause: error }
    );
  }
}

function writeJsonAtomicAsync(target, value, options = {}) {
  const spacing = Number.isInteger(options.spacing) ? options.spacing : 2;
  return writeTextAtomicAsync(target, `${JSON.stringify(value, null, spacing)}\n`, options);
}

function readJsonFile(target, options = {}) {
  const file = path.resolve(String(target));
  const primary = parseJsonFile(file, options.validate);
  if (primary.ok) return primary.value;
  if (primary.missing) return fallbackValue(options);

  const backup = options.backup === true ? path.resolve(String(options.backupPath || `${file}.bak`)) : '';
  let backupReason = '';
  if (backup) {
    const recovered = parseJsonFile(backup, options.validate);
    backupReason = recovered.reason || '';
    if (recovered.ok) {
      if (options.restoreBackup !== false) {
        writeJsonAtomic(file, recovered.value, { mode: options.mode ?? 0o600 });
      }
      options.onRecovery?.({ path: file, backupPath: backup, reason: primary.reason });
      return recovered.value;
    }
  }

  if (Object.hasOwn(options, 'fallback')) return cloneFallback(options.fallback);
  throw readFailure(file, primary, backup, backupReason);
}

async function readJsonFileAsync(target, options = {}) {
  const file = path.resolve(String(target));
  const primary = await parseJsonFileAsync(file, options.validate);
  if (primary.ok) return primary.value;
  if (primary.missing) return fallbackValue(options);

  const backup = options.backup === true ? path.resolve(String(options.backupPath || `${file}.bak`)) : '';
  let backupReason = '';
  if (backup) {
    const recovered = await parseJsonFileAsync(backup, options.validate);
    backupReason = recovered.reason || '';
    if (recovered.ok) {
      if (options.restoreBackup !== false) {
        await writeJsonAtomicAsync(file, recovered.value, { mode: options.mode ?? 0o600 });
      }
      options.onRecovery?.({ path: file, backupPath: backup, reason: primary.reason });
      return recovered.value;
    }
  }

  if (Object.hasOwn(options, 'fallback')) return cloneFallback(options.fallback);
  throw readFailure(file, primary, backup, backupReason);
}

function readFailure(file, primary, backup, backupReason) {
  return new DurableStateError(
    'DURABLE_STATE_READ_FAILED',
    `State file ${path.basename(file)} is unreadable or invalid.`,
    {
      path: file,
      reason: primary.reason,
      backupAttempted: Boolean(backup),
      ...(backup ? { backupPath: backup, backupReason } : {})
    },
    primary.error ? { cause: primary.error } : undefined
  );
}

function parseJsonFile(file, validate) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return readParseFailure(error);
  }
  return parseJsonText(text, validate);
}

async function parseJsonFileAsync(file, validate) {
  let text;
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch (error) {
    return readParseFailure(error);
  }
  return parseJsonText(text, validate);
}

function readParseFailure(error) {
  if (['ENOENT', 'ENOTDIR'].includes(error?.code)) return { ok: false, missing: true, reason: 'missing', error };
  return { ok: false, missing: false, reason: 'read_failed', error };
}

function parseJsonText(text, validate) {
  try {
    const value = JSON.parse(text);
    if (typeof validate === 'function' && validate(value) !== true) {
      return { ok: false, missing: false, reason: 'validation_failed' };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, missing: false, reason: 'malformed_json', error };
  }
}

function fallbackValue(options) {
  if (Object.hasOwn(options, 'fallback')) return cloneFallback(options.fallback);
  return null;
}

function cloneFallback(value) {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function copyFileAtomic(source, destination, mode) {
  const temporary = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(descriptor, fs.readFileSync(source));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    promoteFile(temporary, destination);
  } finally {
    if (descriptor != null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
}

async function copyFileAtomicAsync(source, destination, mode, durable) {
  const temporary = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let handle = null;
  try {
    handle = await fs.promises.open(temporary, 'wx', mode);
    await handle.writeFile(await fs.promises.readFile(source));
    if (durable) await handle.sync();
    await handle.close();
    handle = null;
    await promoteFileAsync(temporary, destination);
  } finally {
    if (handle != null) {
      try { await handle.close(); } catch {}
    }
    try { await fs.promises.rm(temporary, { force: true }); } catch {}
  }
}

function promoteFile(source, destination) {
  try {
    fs.renameSync(source, destination);
    return;
  } catch (error) {
    if (!fs.existsSync(destination) || !['EEXIST', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
  }

  const displaced = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.old`;
  fs.renameSync(destination, displaced);
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    try { fs.renameSync(displaced, destination); } catch {}
    throw error;
  }
  fs.rmSync(displaced, { force: true });
}

async function promoteFileAsync(source, destination) {
  try {
    await fs.promises.rename(source, destination);
    return;
  } catch (error) {
    if (!await pathExistsAsync(destination) || !['EEXIST', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
  }

  const displaced = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.old`;
  await fs.promises.rename(destination, displaced);
  try {
    await fs.promises.rename(source, destination);
  } catch (error) {
    try { await fs.promises.rename(displaced, destination); } catch {}
    throw error;
  }
  await fs.promises.rm(displaced, { force: true });
}

function syncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EACCES', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    if (descriptor != null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

async function syncDirectoryAsync(directory) {
  let handle;
  try {
    handle = await fs.promises.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EACCES', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    if (handle != null) {
      try { await handle.close(); } catch {}
    }
  }
}

async function pathExistsAsync(file) {
  try {
    await fs.promises.access(file);
    return true;
  } catch {
    return false;
  }
}

export { DurableStateError, promoteFile, readJsonFile, readJsonFileAsync, writeJsonAtomic, writeJsonAtomicAsync, writeTextAtomic, writeTextAtomicAsync };
