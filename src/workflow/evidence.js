import * as crypto from 'node:crypto';
import { stableJson } from './contracts.js';

function buildWorkflowEvidenceReceipt({ tool = '', args = {}, result = {}, auditEntry = {}, repositoryFingerprint = '', commandId = '' } = {}) {
  const kind = evidenceKind(tool, args, result);
  if (!kind) return null;
  const command = normalizeCommand(args.command || result.commandSummary || result.command || '');
  const cwd = normalizeCwd(args.cwd || result.cwd || '.');
  const outcome = result.ok === false ? 'failed' : kind === 'check' ? 'passed' : 'observed';
  const target = safeTarget(args, result);
  const receipt = {
    version: 1,
    key: `${kind}:${crypto.createHash('sha256').update(stableJson([tool, commandId, command, cwd, target])).digest('hex')}`,
    kind,
    sourceTool: String(tool || '').slice(0, 100),
    createdAt: safeIso(auditEntry.ts || auditEntry.timestamp),
    outcome,
    repositoryFingerprint: String(repositoryFingerprint || '').slice(0, 256),
    mutationGeneration: nonNegativeInt(auditEntry.taskMutationGeneration),
    workspaceGeneration: nonNegativeInt(auditEntry.taskWorkspaceGeneration),
    paths: safePaths(result.changedFiles || args.paths || (args.path ? [args.path] : [])),
    metadata: compactMetadata(result, tool)
  };
  if (kind === 'check') {
    receipt.commandId = String(commandId || '').slice(0, 240);
    receipt.command = command;
    receipt.cwd = cwd;
    receipt.failureSignature = outcome === 'failed' ? failureSignature({ tool, action: args.action, commandId, command, cwd, result, target }) : '';
  }
  return receipt;
}

function checkEvidenceReusable(receipt, current = {}) {
  return Boolean(receipt && receipt.kind === 'check' && receipt.outcome === 'passed'
    && String(receipt.commandId || '') === String(current.commandId || '')
    && normalizeCommand(receipt.command) === normalizeCommand(current.command)
    && normalizeCwd(receipt.cwd) === normalizeCwd(current.cwd)
    && receipt.repositoryFingerprint
    && String(receipt.repositoryFingerprint) === String(current.repositoryFingerprint || ''));
}

function repeatFailureCount(receipts = []) {
  const failures = receipts.filter(item => item?.outcome === 'failed' && item.failureSignature).slice(-12);
  if (!failures.length) return 0;
  const latest = failures.at(-1).failureSignature;
  return failures.filter(item => item.failureSignature === latest).length;
}

function failureSignature({ tool, action, commandId, command, cwd, result, target }) {
  const value = [normalizeToken(tool), normalizeToken(action || commandId), normalizeCommand(command), normalizeCwd(cwd), String(result?.errorCode || result?.exitCode || '').trim(), String(target || '').trim()];
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function evidenceKind(tool, args, result) {
  if (tool === 'relai_exec' && looksLikeCheck(args?.command || result?.commandSummary || result?.command)) return 'check';
  if (tool === 'relai_run_checks' || tool === 'relai_validate') return 'check';
  if (tool === 'relai_read') return 'read';
  if (tool === 'relai_ui') return 'ui';
  if (/inspect|search/.test(tool)) return 'inspection';
  if (/diff|changes/.test(tool)) return 'review';
  if (/process_(?:start|read)/.test(tool)) return 'process';
  return '';
}
function looksLikeCheck(command) { return /(?:^|\s)(test|lint|check|typecheck|build|pytest|cargo test|go test|flutter test|dart analyze)(?:\s|$|:)/i.test(String(command || '')); }
function normalizeCommand(value) { return String(value || '').trim().replace(/\s+/g, ' '); }
function normalizeCwd(value) { const text = String(value || '.').trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, ''); return text || '.'; }
function safeTarget(args, result) { return String(args.path || args.target || args.processId || result.processId || '').slice(0, 500); }
function safePaths(values) { return [...new Set((Array.isArray(values) ? values : []).map(item => String(item || '').trim().replaceAll('\\', '/')).filter(Boolean))].slice(0, 100); }
function safeIso(value) { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString(); }
function nonNegativeInt(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0; }
function compactMetadata(result = {}, tool = '') {
  const output = {};
  if (Number.isFinite(Number(result.exitCode))) output.exitCode = Number(result.exitCode);
  if (Number.isFinite(Number(result.durationMs))) output.durationMs = Math.max(0, Number(result.durationMs));
  if (result.validationStatus) output.validationStatus = String(result.validationStatus).slice(0, 40);
  if (result.processId) output.processId = String(result.processId).slice(0, 200);
  if (result.reviewHash) output.reviewHash = String(result.reviewHash).slice(0, 128);
  if (result.reviewScope) output.reviewScope = String(result.reviewScope).slice(0, 40);
  if (tool === 'relai_ui') {
    if (result.action) output.uiAction = String(result.action).slice(0, 40);
    if (result.sessionId) output.sessionId = String(result.sessionId).slice(0, 200);
    if (result.route || result.url) output.route = String(result.route || result.url).slice(0, 500);
    if (Number.isFinite(Number(result.consoleErrorCount))) output.consoleErrorCount = Math.max(0, Number(result.consoleErrorCount));
    if (Number.isFinite(Number(result.networkFailureCount))) output.networkFailureCount = Math.max(0, Number(result.networkFailureCount));
    if (result.evidenceId) output.evidenceId = String(result.evidenceId).slice(0, 200);
  }
  if (tool === 'relai_read' && Array.isArray(result.items)) {
    output.reads = result.items.slice(0, 50).map(item => ({
      path: String(item?.path || '').trim().replaceAll('\\', '/').slice(0, 500),
      sha256: String(item?.sha256 || '').trim().slice(0, 128),
      startLine: nonNegativeInt(item?.lineRange?.startLine || item?.startLine || 1) || 1,
      endLine: nonNegativeInt(item?.lineRange?.endLine || item?.endLine || item?.lineCount || 1) || 1
    })).filter(item => item.path && item.sha256);
  }
  return output;
}
function normalizeToken(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, '_'); }

export { buildWorkflowEvidenceReceipt, checkEvidenceReusable, repeatFailureCount };