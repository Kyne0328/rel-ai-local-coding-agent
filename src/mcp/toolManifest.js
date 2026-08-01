import * as crypto from 'node:crypto';
import { getToolSchemas, getToolSurfaceManifest } from '../tools/schema.js';

function buildToolManifest(config = {}) {
  const surface = getToolSurfaceManifest();
  const tools = getToolSchemas(config)
    .map(tool => ({
      name: String(tool.name || ''),
      title: String(tool.title || ''),
      description: String(tool.description || ''),
      inputSchema: canonicalValue(tool.inputSchema || {}),
      outputSchema: canonicalValue(tool.outputSchema || {}),
      annotations: canonicalValue(tool.annotations || {}),
      enabled: true,
      authorizationVisibility: 'authenticated'
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const canonical = {
    schemaVersion: 2,
    toolSurfaceVersion: Number(surface.toolSurfaceVersion || 0),
    tools
  };
  const hash = crypto.createHash('sha256').update(stableJson(canonical)).digest('base64url');
  return Object.freeze({
    ...canonical,
    hash,
    version: hash.slice(0, 24),
    activeToolCount: tools.length,
    disabledToolCount: 0,
    filteredToolCount: 0,
    externallyVisibleToolCount: tools.length
  });
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = canonicalValue(value[key]);
  }
  return result;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export { buildToolManifest, canonicalValue, stableJson };
