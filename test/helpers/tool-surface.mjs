import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getToolSchemas } = require('../../src/tools/schema.js');

export const activeToolNames = getToolSchemas().map(tool => tool.name);
export const activeToolCount = activeToolNames.length;
