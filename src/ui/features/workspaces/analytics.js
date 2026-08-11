import { analyticsBounds, analyticsMonths, analyticsRangeScope, normalizeUsageSnapshot } from '../usage/range-model.js';

export function hydrateWorkspaceAnalytics(root, aliases, { desktop = globalThis.window?.relaiDesktop, now = new Date() } = {}) {
  const uniqueAliases = [...new Set((aliases || []).map(String).filter(Boolean))];
  if (!root || !uniqueAliases.length || !desktop?.getGatewayUsage || !desktop?.getLocalUsage || !desktop?.getGatewayStatus) return Promise.resolve(false);
  return Promise.resolve().then(async () => {
    const status = await desktop.getGatewayStatus();
    const gateway = status?.gateway && typeof status.gateway === 'object' ? status.gateway : {};
    const direct = status?.connectionMode === 'direct';
    if (!direct && (gateway.state !== 'connected' || gateway.principalPaired !== true)) return false;
    const usageReader = direct ? desktop.getLocalUsage : desktop.getGatewayUsage;
    const bounds = analyticsBounds('24h', { now });
    const models = await Promise.all(analyticsMonths(bounds).map(async month => normalizeUsageSnapshot(await usageReader(month), month)));
    if (!root.isConnected && typeof root.isConnected === 'boolean') return false;
    for (const alias of uniqueAliases) {
      const scope = analyticsRangeScope(models, bounds, { workspace: alias });
      const target = root.querySelector(`[data-workspace-analytics="${cssEscape(alias)}"]`);
      if (!target) continue;
      target.innerHTML = workspaceAnalyticsHtml(scope);
      target.hidden = false;
    }
    return true;
  }).catch(() => false);
}

export function workspaceAnalyticsHtml(scope) {
  const completed = Number(scope?.completed || 0);
  const toolCalls = Number(scope?.toolCalls || 0);
  const successRate = Number(scope?.successRate || 0);
  const averageDuration = Number(scope?.averageDuration || 0);
  const values = Array.isArray(scope?.points) ? scope.points.map(point => Number(point.toolCalls || 0)) : [];
  return `<div class="workspace-analytics-head"><span>Last 24 hours</span><small>${scope?.source === 'local' ? 'Local analytics' : 'Cloud analytics'}</small></div>
    <div class="workspace-analytics-metrics">
      ${miniMetric('Tool calls', formatInteger(toolCalls))}
      ${miniMetric('Success', completed ? formatPercent(successRate) : '—')}
      ${miniMetric('Avg time', completed ? formatDuration(averageDuration) : '—')}
    </div>
    ${sparkline(values)}`;
}

function miniMetric(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function sparkline(values) {
  const data = (values || []).map(Number).map(value => Number.isFinite(value) && value >= 0 ? value : 0);
  const width = 220;
  const height = 30;
  if (!data.length) return '<span class="workspace-analytics-sparkline-empty" aria-hidden="true"></span>';
  const max = Math.max(...data, 1);
  const points = data.map((value, index) => `${data.length === 1 ? width / 2 : index / (data.length - 1) * width},${height - 2 - value / max * (height - 5)}`).join(' ');
  return `<svg class="workspace-analytics-sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/["\\]/g, character => `\\${character}`);
}
function formatInteger(value) { return Math.floor(Number(value) || 0).toLocaleString(); }
function formatPercent(value) { const number = Number(value) || 0; return `${number.toFixed(number >= 10 ? 1 : 2)}%`; }
function formatDuration(value) { const ms = Number(value) || 0; if (ms < 1000) return `${Math.floor(ms)} ms`; const seconds = ms / 1000; if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`; return `${(seconds / 60).toFixed(1)} min`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
