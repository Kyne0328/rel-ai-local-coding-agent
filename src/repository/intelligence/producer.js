import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const INTELLIGENCE_SOURCE_FILES = Object.freeze([
  'src/repository/intelligence/architecture.js',
  'src/repository/intelligence/contextPlanner.js',
  'src/repository/intelligence/crossWorkspace.js',
  'src/repository/intelligence/database.js',
  'src/repository/intelligence/ecosystemResolution.js',
  'src/repository/intelligence/graphDiffusion.js',
  'src/repository/intelligence/indexBuild.js',
  'src/repository/intelligence/languages.js',
  'src/repository/intelligence/producer.js',
  'src/repository/intelligence/queryService.js',
  'src/repository/intelligence/relationshipPolicy.js',
  'src/repository/intelligence/treeSitter.js',
  'src/repository/intelligence/resolvers/cFamily.js',
  'src/repository/intelligence/resolvers/common.js',
  'src/repository/intelligence/resolvers/csharp.js',
  'src/repository/intelligence/resolvers/frameworks.js',
  'src/repository/intelligence/resolvers/go.js',
  'src/repository/intelligence/resolvers/index.js',
  'src/repository/intelligence/resolvers/java.js',
  'src/repository/intelligence/resolvers/javascript.js',
  'src/repository/intelligence/resolvers/kotlin.js',
  'src/repository/intelligence/resolvers/php.js',
  'src/repository/intelligence/resolvers/python.js',
  'src/repository/intelligence/resolvers/ruby.js',
  'src/repository/intelligence/resolvers/rust.js'
]);

let runtimeFingerprint = '';

function intelligenceRuntimeFingerprint() {
  runtimeFingerprint ||= fingerprintRoot(RUNTIME_ROOT) || 'unavailable';
  return runtimeFingerprint;
}

function intelligenceWorkspaceFingerprint(root) {
  const resolved = path.resolve(String(root || '.'));
  if (!isRelAiRepository(resolved)) return null;
  return fingerprintRoot(resolved);
}

function fingerprintRoot(root) {
  const hash = crypto.createHash('sha256');
  try {
    for (const relativePath of INTELLIGENCE_SOURCE_FILES) {
      const file = path.join(root, ...relativePath.split('/'));
      const data = fs.readFileSync(file);
      hash.update(relativePath).update('\0').update(data).update('\0');
    }
    return hash.digest('base64url').slice(0, 24);
  } catch {
    return null;
  }
}

function isRelAiRepository(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return pkg?.name === 'rel-ai-mcp';
  } catch { return false; }
}

export { INTELLIGENCE_SOURCE_FILES, intelligenceRuntimeFingerprint, intelligenceWorkspaceFingerprint };
