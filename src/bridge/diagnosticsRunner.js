
import * as path from 'node:path';
import { runProcess, summarizeCommand } from '../process.js';
import { detectVerifyChecks } from './checkDetection.js';
import { clampNumber } from './limits.js';
import { runSpan } from '../telemetry.js';
import { nativeToolTaskSignal } from '../mcp/nativeToolTasks.js';
import { combineAbortSignals } from '../abortSignals.js';
import { getCurrentTaskAbortSignal, updateCurrentToolActivity } from '../toolActivity.js';
import { sanitizeDisplayText } from '../taskObservability.js';
async function relaiDiagnosticsRun(workspace, config, args = {}, context = {}) {
  const commands = selectDiagnosticCommands(workspace, args);
  if (!commands.length) {
    return { ok: false, workspace: workspace.alias, commands: [], diagnostics: [], message: 'No diagnostic command was detected. Pass command or configure lint/typecheck/analyze/vet/clippy checks.' };
  }
  const timeout = clampNumber(args.timeoutMs, 1000, 24 * 60 * 60 * 1000, 180000);
  const results = [];
  const diagnostics = [];
  const signal = combineAbortSignals(
    getCurrentTaskAbortSignal(),
    args._operationTaskId ? nativeToolTaskSignal(args._operationTaskId) : undefined,
    context.signal
  );
  publishDiagnosticsProgress(commands, results, '', 0, 'pending');
  for (let index = 0; index < commands.length; index += 1) {
    if (signal?.aborted) break;
    const command = commands[index];
    publishDiagnosticsProgress(commands, results, command, index + 1, 'running');
    const result = await runSpan(config, 'relai.validation.diagnostics', {
      'relai.workspace': workspace.alias,
      'relai.diagnostics.command': command.slice(0, 300)
    }, () => runProcess(command, [], {
      cwd: workspace.path,
      shell: true,
      commandString: command,
      timeout,
      maxOutputBytes: Math.min(Number(args._transportMaxOutputBytes) || 8 * 1024 * 1024, 8 * 1024 * 1024),
      signal
    }, config));
    const summary = summarizeCommand(result);
    const parsed = parseDiagnostics(`${result.stdout || ''}\n${result.stderr || ''}`, command, workspace.path);
    results.push({ command, ...summary, diagnostics: parsed.length });
    diagnostics.push(...parsed);
    publishDiagnosticsProgress(commands, results, command, index + 1, result.cancelled ? 'cancelled' : result.ok ? 'passed' : result.timedOut ? 'timed_out' : 'failed');
    if (result.cancelled) break;
    if (args.stopOnFailure !== false && result.exitCode !== 0) break;
  }
  const unique = deduplicateDiagnostics(diagnostics).slice(0, clampNumber(args.maxResults, 1, 5000, 500));
  const cancelled = signal?.aborted === true || results.some(item => item.cancelled === true);
  const ok = !cancelled && results.length === commands.length && results.every(item => item.ok);
  publishDiagnosticsProgress(commands, results, results.at(-1)?.command || '', Math.min(results.length, commands.length), cancelled ? 'cancelled' : ok ? 'passed' : 'failed', true);
  return {
    ok,
    workspace: workspace.alias,
    commands,
    results,
    diagnostics: unique,
    diagnosticCount: diagnostics.length,
    completedUnits: results.filter(item => item.cancelled !== true).length,
    totalUnits: commands.length,
    cancelled,
    truncated: diagnostics.length > unique.length
  };
}

function publishDiagnosticsProgress(commands, results, currentCommand, currentIndex, resultStatus, final = false) {
  const total = commands.length;
  const completed = results.filter(item => item.cancelled !== true).length;
  const current = sanitizeDisplayText(currentCommand, 300);
  const failed = results.filter(item => !item.ok && !item.cancelled).length;
  const stage = resultStatus === 'cancelled'
    ? 'Diagnostics cancelled'
    : resultStatus === 'failed' || resultStatus === 'timed_out'
      ? 'Diagnostics failed'
      : final && resultStatus === 'passed'
        ? 'Diagnostics completed'
        : currentIndex > 0
          ? `Running diagnostic ${currentIndex} of ${total}`
          : 'Preparing diagnostics';
  updateCurrentToolActivity({
    status: 'validating',
    operation: currentIndex > 0 ? `Running diagnostic ${currentIndex}/${total}: ${current || 'check'}` : `Preparing ${total} diagnostic commands`,
    currentStage: stage,
    currentActivity: current || `${completed} of ${total} diagnostics completed`,
    progress: {
      mode: 'determinate',
      completedUnits: completed,
      totalUnits: total,
      percentage: final && resultStatus !== 'passed' && completed === total ? 99 : Math.round((completed / total) * 100),
      source: 'diagnostics',
      label: `${completed} of ${total} diagnostics`
    },
    activity: {
      category: 'validation',
      status: 'running',
      title: 'Run normalized diagnostics',
      summary: current || `${completed} of ${total} diagnostics completed`,
      metadata: {
        checkCount: total,
        passedCount: results.filter(item => item.ok).length,
        failedCount: failed,
        currentCheck: current,
        currentIndex,
        resultStatus,
        cancelled: resultStatus === 'cancelled'
      }
    }
  });
}

function selectDiagnosticCommands(workspace, args) {
  const explicit = [];
  if (typeof args.command === 'string' && args.command.trim()) explicit.push(args.command.trim());
  if (Array.isArray(args.commands)) explicit.push(...args.commands.map(String).map(item => item.trim()).filter(Boolean));
  if (explicit.length) return [...new Set(explicit)];
  const candidates = detectVerifyChecks(workspace.path, String(args.level || 'quick'));
  const diagnostic = candidates.filter(command => /(?:typecheck|tsc|eslint|lint|analy[sz]e|mypy|pyright|ruff|vet|clippy|doctor|check)/i.test(command));
  return diagnostic.length ? diagnostic : candidates.slice(0, 2);
}

function parseDiagnostics(output, command, workspaceRoot) {
  const source = diagnosticSource(command);
  const diagnostics = [];
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = parseDiagnosticLine(line);
    if (!parsed) continue;
    diagnostics.push({
      path: normalizeDiagnosticPath(parsed.path, workspaceRoot),
      line: parsed.line,
      column: parsed.column,
      severity: parsed.severity,
      code: parsed.code,
      message: parsed.message.slice(0, 2000),
      source
    });
  }
  return diagnostics;
}

function parseDiagnosticLine(line) {
  let match = /^(.*?)[(:](\d+)[,:](\d+)\)?\s*[-:]\s*(error|warning|warn|info)?\s*([A-Za-z]+\d+)?\s*[:-]?\s*(.+)$/i.exec(line);
  if (match) return { path: match[1], line: Number(match[2]), column: Number(match[3]), severity: normalizeSeverity(match[4]), code: match[5] || '', message: match[6] };
  match = /^(.*?):(\d+):(\d+):\s*(error|warning|note|info):\s*(.+?)(?:\s+\[([^\]]+)\])?$/i.exec(line);
  if (match) return { path: match[1], line: Number(match[2]), column: Number(match[3]), severity: normalizeSeverity(match[4]), code: match[6] || '', message: match[5] };
  match = /^(.+?):(\d+):(\d+)\s+([A-Z]\d+)\s+(.+)$/.exec(line);
  if (match) return { path: match[1], line: Number(match[2]), column: Number(match[3]), severity: 'error', code: match[4], message: match[5] };
  return null;
}

function normalizeDiagnosticPath(value, root) {
  const text = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!text) return '';
  if (path.isAbsolute(text)) return path.relative(root, text).replaceAll(path.sep, '/');
  return text.replaceAll('\\', '/').replace(/^\.\//, '');
}

function normalizeSeverity(value) {
  const text = String(value || 'error').toLowerCase();
  if (text === 'warn') return 'warning';
  if (text === 'note') return 'info';
  return ['error', 'warning', 'info'].includes(text) ? text : 'error';
}

function diagnosticSource(command) {
  const text = String(command).toLowerCase();
  for (const source of ['typescript', 'eslint', 'mypy', 'pyright', 'ruff', 'dart', 'flutter', 'clippy', 'cargo', 'go', 'javac', 'gradle']) {
    if (text.includes(source)) return source;
  }
  if (text.includes('tsc')) return 'typescript';
  if (text.includes('analyze')) return 'analyzer';
  return 'command';
}

function deduplicateDiagnostics(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.path}:${item.line}:${item.column}:${item.code}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export { relaiDiagnosticsRun, parseDiagnostics, parseDiagnosticLine, publishDiagnosticsProgress };