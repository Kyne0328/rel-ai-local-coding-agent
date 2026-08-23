import { getMcpToolSchemas, getToolSchemas, getToolSurfaceManifest } from "../../src/tools/schema.js";

export const activeToolNames = getToolSchemas().map(tool => tool.name);
export const activeToolCount = activeToolNames.length;
export const activeMcpToolNames = getMcpToolSchemas().map(tool => tool.name);
export const activeMcpToolCount = activeMcpToolNames.length;
export const activeToolSurface = getToolSurfaceManifest();
