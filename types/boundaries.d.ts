type ToolName = string;
export type ToolGroup = 'git' | 'audit' | 'cleanup';
type AuditKind = '' | 'snapshot' | 'read' | 'path' | 'checks' | 'edit' | 'exec' | 'completion';
type CacheKind = '' | 'paths' | 'edit' | 'workspace';
type SummaryKind = '' | 'checks' | 'diff' | 'edit' | 'completion';

type WorkflowStage = 'understand' | 'investigate' | 'design' | 'implement' | 'verify' | 'review' | 'repair' | 'complete' | 'blocked';
type WorkflowIntent = 'auto' | 'investigation' | 'bugfix' | 'feature' | 'refactor' | 'migration' | 'documentation' | 'review' | 'release';
type WorkflowRiskLevel = 'low' | 'medium' | 'high' | 'critical';
type WorkflowBoundaryLevel = 'file' | 'package' | 'cross_package' | 'repository' | 'release';

interface WorkflowAction {
  id: string;
  priority: number;
  tool: string;
  action: string;
  reason: string;
  blocking: boolean;
  estimatedCost: 'small' | 'medium' | 'large';
  args: Record<string, unknown>;
}

interface WorkflowRisk { level: WorkflowRiskLevel; reasons: string[]; }
interface WorkflowBoundary { level: WorkflowBoundaryLevel; packageIds: string[]; changedFiles: string[]; impactedPaths: string[]; affectedTests: string[]; }
interface WorkflowEvidenceSummary { fresh: number; stale: number; reusable: number; lastMutationGeneration: number; lastValidatedMutationGeneration: number; }
interface WorkflowCompletionReadiness { hardReady: boolean; blockers: string[]; recommendations: string[]; }
interface WorkflowSnapshot {
  version: 1;
  stage: WorkflowStage;
  intent: WorkflowIntent;
  confidence: 'low' | 'medium' | 'high';
  boundary: WorkflowBoundary;
  risk: WorkflowRisk;
  evidence: WorkflowEvidenceSummary;
  recommendedActions: WorkflowAction[];
  avoidActions: Array<{ action: string; reason: string }>;
  completion: WorkflowCompletionReadiness;
  repeatCount?: number;
}

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  enum?: string[];
  const?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  not?: JsonSchema;
  pattern?: string;
}

interface ObjectJsonSchema extends JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchema>;
  required: string[];
  additionalProperties: false;
}

interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

type ToolExecutionClass = 'always_immediate' | 'bounded_synchronous' | 'native_task_eligible' | 'persistent_process';

interface ToolExecution {
  taskSupport: 'required' | 'optional' | 'forbidden';
}

interface ToolBehavior {
  audit: AuditKind;
  cache: CacheKind;
  startsSession: boolean;
  deferStagedSession: boolean;
  sessionWrite: boolean;
  summary: SummaryKind;
  longRunning: boolean;
  taskScope: 'required' | 'optional' | 'none';
  concurrencyScope: 'task' | 'workspace';
  executionClass: ToolExecutionClass;
}

type ToolCapability = 'inspect' | 'edit' | 'validate' | 'git' | 'recover';

interface ToolDashboardMetadata {
  category: string;
  requiredProfile: 'workspace';
  requiresApproval: boolean;
  capabilities?: readonly ToolCapability[];
}

interface ToolLifecycleMetadata {
  state: 'active' | 'deprecated';
  replacement?: ToolName;
  replacements?: ToolName[];
  deprecatedSince?: number;
  removalTarget?: number;
  note?: string;
}

export interface ToolDefinitionMetadata {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: ObjectJsonSchema;
  outputSchema: JsonSchema;
  annotations: ToolAnnotations;
  execution?: ToolExecution;
  handlerName: string;
  connectorStrip: string[];
  groups: ToolGroup[];
  behavior: ToolBehavior;
  dashboard: ToolDashboardMetadata;
  lifecycle?: ToolLifecycleMetadata;
}


export interface ToolSchema {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: ObjectJsonSchema;
  outputSchema?: JsonSchema;
  annotations: ToolAnnotations;
  execution?: ToolExecution;
}

export interface ToolArgs extends Record<string, unknown> {
  workspace?: string;
  work_id?: string;
  title?: string;
  objective?: string;
  bootstrap?: 'compact' | 'full' | 'none';
  instructionPath?: string;
  path?: string;
  paths?: string[];
  startLine?: number;
  endLine?: number;
  guidanceMode?: string;
  mode?: string;
  contextBefore?: number;
  contextAfter?: number;
  groupByFile?: boolean;
  mergeOverlaps?: boolean;
  maxFiles?: number;
  maxRangesPerFile?: number;
  maxRangeLines?: number;
  maxBytes?: number;
  maxResults?: number;
  dryRun?: boolean;
  stage?: string;
  updateText?: string;
  edits?: Array<{ path?: string }>;
  timeoutMs?: number;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  maxOutputBytes?: number;
  processId?: string;
  stdoutOffset?: number;
  stderrOffset?: number;
  input?: string;
  label?: string;
  startupWaitMs?: number;
  maxLogBytes?: number;
  graceMs?: number;
  limit?: number;
  status?: string;
  name?: string;
  base?: string;
  branch?: string;
  alias?: string;
  force?: boolean;
  query?: string;
  pathPrefix?: string;
  language?: string;
  commands?: string[];
  planId?: string;
  planLevel?: string;
  release?: boolean;
  defer?: boolean;
  operationTaskId?: string;
  complete?: boolean;
  summary?: string;
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
  completionKnown?: boolean;
  endReason?: string;
  completionSource?: string;
  summary?: string;
  validationAt?: string;
  changedFiles?: string[];
  nextAction?: string;
  commandSummary?: string;
  cwd?: string;
  exitCode?: number;
  durationMs?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  timedOut?: boolean;
  mutationTracking?: string;
  environmentKeys?: string[];
  matches?: Array<{ path: string; line: number; text: string }>;
  files?: Array<Record<string, unknown>>;
  contexts?: Array<Record<string, unknown>>;
  matchCount?: number;
  contextMatchCount?: number;
  effectiveMode?: string;
  autoTier?: string;
  selectionStrategy?: string;
  returnedFileCount?: number;
  returnedRangeCount?: number;
  returnedBytes?: number;
  contextTruncated?: boolean;
  workflow?: WorkflowSnapshot;
}


export interface LauncherConfigInput {
  port?: number | string;
  tunnelId?: string;
  tunnelApiKey?: string;
  token?: string;
}

export interface LauncherConfig {
  port: number;
  tunnelId: string;
  token: string;
}

export type LocalServiceStatus = 'running' | 'starting' | 'stopped' | 'failed';
export type PublicEndpointStatus = 'available' | 'connecting' | 'unavailable' | 'disabled';
export type ChatgptReadinessStatus = 'ready' | 'unavailable';
export type DashboardUpdateStatus = 'live' | 'connecting' | 'reconnecting' | 'paused' | 'offline';
export type DesktopErrorCode =
  | 'unknown'
  | 'request_invalid'
  | 'configuration_invalid'
  | 'local_service_start_failed'
  | 'local_service_stop_failed'
  | 'local_port_in_use'
  | 'secure_tunnel_failed'
  | 'public_endpoint_failed'
  | 'dashboard_unavailable'
  | 'workspace_unavailable'
  | 'settings_save_failed'
  | 'diagnostics_unavailable'
  | 'diagnostics_export_failed'
  | 'state_reset_failed'
  | 'update_failed';

export interface StructuredRecoveryAction {
  message: string;
  actionLabel: string;
  href: string;
  retryable: boolean;
}

export interface StructuredErrorPayload {
  ok: false;
  errorCode: DesktopErrorCode;
  error: string;
  title: string;
  recovery: StructuredRecoveryAction;
  status?: number;
}

export interface DiagnosticFinding {
  id: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
  title: string;
  impact: string;
  recommendation: string;
  action: { label: string; href: string };
  context: unknown[];
  details: Record<string, unknown>;
}

export interface DiagnosticReport {
  ok: true;
  generatedAt: string;
  scope: { workspace: string };
  summary: { blocking: number; warnings: number; recommendations: number; total: number };
  findings: DiagnosticFinding[];
  reportText: string;
}

export interface DesktopConnectionState {
  localService: { status: LocalServiceStatus };
  publicEndpoint: { status: PublicEndpointStatus };
  chatgptReadiness: { status: ChatgptReadinessStatus };
  dashboardUpdates: { status: DashboardUpdateStatus };
  error: null | { code: DesktopErrorCode; message: string };
}


