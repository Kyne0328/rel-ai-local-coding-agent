import { callTool } from './tools/callTool.js';
import { compactForConnector, policySentence } from './tools/connector.js';
import { enhanceToolError } from './tools/errors.js';
import { getExecutableToolDefinition, getExecutableToolDefinitions } from './tools/runtimeRegistry.js';
import {
  TOOL_NAMES,
  getPublicToolSchemas,
  getToolGroups,
  getToolMetadata,
  getToolSchemas,
  getToolSurfaceManifest,
  toolSchemas
} from './tools/schema.js';

const getToolDefinition = getExecutableToolDefinition;
const getToolDefinitions = getExecutableToolDefinitions;

export {
  TOOL_NAMES,
  callTool,
  compactForConnector,
  enhanceToolError,
  getPublicToolSchemas,
  getToolDefinition,
  getToolDefinitions,
  getToolGroups,
  getToolMetadata,
  getToolSchemas,
  getToolSurfaceManifest,
  policySentence,
  toolSchemas
};
