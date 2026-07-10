export type ToolName = string;
export type ToolGroup = 'git' | 'audit' | 'cleanup';
export type AuditKind = '' | 'snapshot' | 'read' | 'path' | 'clearPaths' | 'checks' | 'policy' | 'edit';
export type CacheKind = '' | 'workspace' | 'paths' | 'clearPaths' | 'policy' | 'edit';
export type SummaryKind = '' | 'checks' | 'diff' | 'edit';

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

export interface ObjectJsonSchema extends JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchema>;
  required: string[];
  additionalProperties: false;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolBehavior {
  audit: AuditKind;
  cache: CacheKind;
  startsSession: boolean;
  deferStagedSession: boolean;
  sessionWrite: boolean;
  summary: SummaryKind;
}

export interface ToolDashboardMetadata {
  category: string;
  requiredProfile: 'workspace';
  requiresApproval: boolean;
}

export interface ToolDefinition {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: ObjectJsonSchema;
  annotations: ToolAnnotations;
  handler: string;
  public: boolean;
  publicOrder: number;
  publicStrip: string[];
  groups: ToolGroup[];
  behavior: ToolBehavior;
  dashboard: ToolDashboardMetadata;
}

export interface ToolSchema {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: ObjectJsonSchema;
  annotations: ToolAnnotations;
}

export interface ToolArgs extends Record<string, unknown> {
  workspace?: string;
  path?: string;
  paths?: string[];
  dryRun?: boolean;
  stage?: string;
  updateText?: string;
  edits?: Array<{ path?: string }>;
  clear?: boolean;
}

export interface ToolResult extends Record<string, unknown> {
  ok?: boolean;
  plannerPath?: string;
  plannerReason?: string;
  validationLevel?: string;
  validationLevelReason?: string;
  aliasNormalizations?: number;
  policy?: { sessionActive?: boolean };
  operation?: string;
  items?: Array<{ cacheHit?: boolean }>;
  effectiveMaxEntries?: number;
  budgetMultiplied?: boolean;
}

export type AppConfig = Record<string, unknown> & {
  workspaces?: Record<string, unknown>;
};

export type ToolHandler = (config: AppConfig, args: ToolArgs) => unknown | Promise<unknown>;

export interface LauncherConfigInput {
  port?: number | string;
  ngrokDomain?: string;
  domain?: string;
  ngrokAuthtoken?: string;
  ngrokToken?: string;
  token?: string;
}

export interface LauncherConfig {
  port: number;
  ngrokDomain: string;
  ngrokAuthtoken: string;
  token: string;
}

export interface InstalledSmokeResult {
  ok: true;
  isPackaged: true;
  version: string;
  resourceChecks: Record<string, boolean>;
  health: { ok: boolean; name?: string; version?: string };
  dashboardStatus: number;
  publicToolCount: number;
}
