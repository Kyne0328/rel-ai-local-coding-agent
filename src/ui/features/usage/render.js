import { routeHref } from '../../router.js';
import { esc } from '../../utils.js';
import { deltaFor } from './range-model.js';

const METRIC_HELP = Object.freeze({
  toolCalls: 'Total Rel.AI tool actions recorded in this range. The change compares with the previous equivalent period.',
  reliabilityRate: 'Share of measured, non-cancelled actions that did not fail because of Rel.AI infrastructure. “pp” means percentage points: 90% to 95% is +5 pp.',
  infrastructureFailures: 'Actions classified as Rel.AI infrastructure failures. Expected command or check failures and cancellations are excluded.',
  recoverableFailures: 'Actions that hit a recoverable task or context state and can usually be fixed by retrying or refreshing context.',
  operationSuccessRate: 'Share of recorded actions where the requested command or check succeeded. Rate changes use percentage points (pp).',
  averageDuration: 'Average elapsed time per completed action in this range. The change compares with the previous equivalent period when available.'
});

export function renderUsage(content, { bounds, current, previous }) {
  const fallback = current.usedMonthlyFallback && current.points.every(point => point.toolCalls === 0 && point.requests === 0)
    ? '<p class="usage-series-note">Hourly trends are unavailable for older monthly totals.</p>' : '';
  content.innerHTML = `
    <section class="usage-overview" aria-label="${esc(current.label)} analytics for ${esc(bounds.label)}">
      ${fallback}
      <div class="usage-metrics">${analyticsMetrics(current, previous).map(metricHtml).join('')}</div>
    </section>
    ${timelineSection(current)}
    ${activityBarsSection('Action usage', current.tools, 'tool')}
    ${current.kind === 'workspace'
      ? `${failureCategoriesSection(current.failureCategories, current.failures)}${breakdownSection('Devices', current.devices, 'device')}`
      : `<div class="usage-side-by-side">${failureCategoriesSection(current.failureCategories, current.failures)}${activityBarsSection('Project activity', current.workspaces, 'workspace')}</div>`}`;
  wireTimeline(content, current);
  wireMetricHelp(content);
}

function analyticsMetrics(scope, previous) {
  const values = key => scope.points.map(point => pointMetric(point, key));
  const compare = (key, options = {}) => scope.usedMonthlyFallback || options.available === false || options.previousAvailable === false ? null : deltaFor(scope, previous, key, options);
  const metric = (label, key, value, detail = '', options = {}) => ({ key, label, value, detail, help: METRIC_HELP[key] || '', delta: compare(key, options), values: options.spark === false ? [] : values(options.sparkKey || key), tone: options.metricTone || '' });
  return [
    metric('Actions', 'toolCalls', integer(scope.toolCalls), '', { neutral: true }),
    metric('Reliable actions', 'reliabilityRate', scope.reliabilityCalls ? percent(scope.reliabilityRate) : '—', scope.reliabilityCalls ? `${integer(scope.reliabilityCalls)} measured actions` : 'Starts measuring with new actions', { rate: true, available: scope.reliabilityCalls > 0, previousAvailable: Number(previous?.reliabilityCalls || 0) > 0, spark: false }),
    metric('System errors', 'infrastructureFailures', integer(scope.infrastructureFailures), 'Rel.AI internal errors only', { inverse: true, metricTone: scope.infrastructureFailures ? 'bad' : 'good' }),
    metric('Retryable problems', 'recoverableFailures', integer(scope.recoverableFailures), 'Usually fixed by retrying or refreshing context', { inverse: true }),
    metric('Successful actions', 'operationSuccessRate', scope.completed ? percent(scope.operationSuccessRate) : '—', 'Whether the command or check itself succeeded', { rate: true, sparkKey: 'operationSuccessRate', available: scope.completed > 0, previousAvailable: Number(previous?.completed || 0) > 0 }),
    metric('Average time', 'averageDuration', duration(scope.averageDuration), scope.completed ? 'Per completed action' : '', { inverse: true, sparkKey: 'averageDuration', available: scope.completed > 0, previousAvailable: Number(previous?.completed || 0) > 0 })
  ];
}

function metricHtml(metric) {
  const delta = metric.delta ? `<small class="usage-delta ${esc(metric.delta.tone || '')}">${esc(metric.delta.text)}</small>` : '';
  const detail = metric.detail ? `<small class="usage-metric-detail">${esc(metric.detail)}</small>` : '';
  const helpId = `usage-metric-help-${metric.key}`;
  const help = metric.help ? `<span class="usage-metric-help"><button type="button" class="usage-metric-help-trigger" aria-label="About ${esc(metric.label)}" aria-describedby="${esc(helpId)}" data-usage-metric-help>i</button><span id="${esc(helpId)}" role="tooltip" class="usage-metric-tooltip">${esc(metric.help)}</span></span>` : '';
  return `<article class="usage-metric ${esc(metric.tone)}"><div class="usage-metric-label-row"><span class="usage-metric-label">${esc(metric.label)}</span>${help}</div><div class="usage-metric-value"><strong>${esc(metric.value)}</strong>${delta}</div>${detail}${sparkline(metric.values, metric.tone)}</article>`;
}

function wireMetricHelp(content) {
  content.querySelectorAll('[data-usage-metric-help]').forEach(button => {
    const help = button.closest('.usage-metric-help');
    const metric = button.closest('.usage-metric');
    if (!help || !metric) return;
    const setOpen = open => {
      help.classList.toggle('is-open', open);
      metric.classList.toggle('help-open', open);
    };
    button.addEventListener('pointerenter', () => setOpen(true));
    button.addEventListener('pointerleave', () => {
      if (document.activeElement !== button) setOpen(false);
    });
    button.addEventListener('focus', () => setOpen(true));
    button.addEventListener('blur', () => setOpen(false));
    button.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      event.stopPropagation();
    });
  });
}

function timelineSection(scope) {
  const switches = [['toolCalls', 'Actions'], ['infrastructureFailures', 'System errors'], ['operationSuccessRate', 'Successful actions'], ['averageDuration', 'Average time']];
  return `<section class="card usage-timeline-card" data-usage-timeline><div class="card-head usage-timeline-head"><h3>Activity</h3><div class="usage-chart-switch" role="group" aria-label="Chart metric">${switches.map(([key,label], i) => `<button type="button" class="secondary compact-button${i ? '' : ' active'}" data-usage-chart="${key}" aria-pressed="${i ? 'false' : 'true'}">${label}</button>`).join('')}</div></div><div class="card-body usage-timeline-body" data-usage-chart-body>${timeline(scope.points.map(point => pointMetric(point, 'toolCalls')), 'Actions')}</div></section>`;
}

function wireTimeline(content, scope) {
  const body = content.querySelector('[data-usage-chart-body]');
  content.querySelectorAll('[data-usage-chart]').forEach(button => button.addEventListener('click', () => {
    content.querySelectorAll('[data-usage-chart]').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    if (body) body.innerHTML = timeline(scope.points.map(point => pointMetric(point, button.dataset.usageChart)), button.textContent.trim());
  }));
}

function timeline(values, metricLabel = 'Actions') {
  const data = finite(values); const width = 720; const height = 180; const baseline = height - 12;
  if (!data.length || data.every(value => value === 0)) return '<div class="usage-chart-empty">No activity in this range.</div>';
  const max = Math.max(...data, 1);
  const points = data.map((value, i) => `${data.length === 1 ? width/2 : i/(data.length-1)*width},${baseline-value/max*(height-32)}`).join(' ');
  const area = `0,${baseline} ${points} ${width},${baseline}`;
  const latest = data.at(-1) || 0;
  const peak = Math.max(...data);
  const peakIndex = data.indexOf(peak);
  const bucketsAgo = Math.max(0, data.length - 1 - peakIndex);
  const trend = latest > data[0] ? 'increasing' : latest < data[0] ? 'decreasing' : 'steady';
  const summary = `${metricLabel} trend. Peak ${formatChartValue(peak, metricLabel)} ${bucketsAgo ? `${bucketsAgo} buckets ago` : 'in the latest bucket'}. Latest ${formatChartValue(latest, metricLabel)}. Overall trend ${trend}.`;
  return `<div class="usage-timeline-plot"><svg class="usage-timeline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(summary)}"><line x1="0" y1="${height*.28}" x2="${width}" y2="${height*.28}" class="usage-chart-grid"/><line x1="0" y1="${height*.52}" x2="${width}" y2="${height*.52}" class="usage-chart-grid"/><line x1="0" y1="${height*.76}" x2="${width}" y2="${height*.76}" class="usage-chart-grid"/><polygon points="${area}" class="usage-chart-area"/><line x1="0" y1="${baseline}" x2="${width}" y2="${baseline}" class="usage-chart-axis"/><polyline points="${points}" class="usage-chart-line" fill="none" vector-effect="non-scaling-stroke"/></svg><div class="usage-timeline-scale"><span>Earlier</span><span>Now</span></div></div>`;
}

function sparkline(values, tone='') {
  const data=finite(values); const width=120; const height=28;
  if (!data.length) return '<span class="usage-sparkline-empty" aria-hidden="true"></span>';
  const max=Math.max(...data,1); const points=data.map((value,i)=>`${data.length===1?width/2:i/(data.length-1)*width},${height-2-value/max*(height-5)}`).join(' ');
  return `<svg class="usage-sparkline ${esc(tone)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
}

function pointMetric(point,key) {
  const completed=point.successes+point.failures;
  if(key==='reliabilityRate') return point.reliabilityCalls?point.reliableCalls/point.reliabilityCalls*100:0;
  if(key==='operationSuccessRate') return completed?point.successes/completed*100:0;
  if(key==='successRate') return completed?point.successes/completed*100:0;
  if(key==='averageDuration') return completed?point.executionMs/completed:0;
  return Number(point[key]||0);
}

function failureCategoriesSection(rows, totalFailures = 0) {
  const visible = [...(rows || [])].sort((a, b) => b.failures - a.failures).slice(0, 10);
  const max = Math.max(1, ...visible.map(row => row.failures));
  const body = visible.length
    ? `<div class="usage-bar-list">${visible.map(row => failureCategoryRow(row, max)).join('')}</div>`
    : `<div class="usage-breakdown-empty">${Number(totalFailures || 0) > 0 ? 'Failure categories are unavailable for older data.' : 'No failures in this range.'}</div>`;
  return `<section class="card usage-breakdown usage-bar-card"><div class="card-head"><div><h3>What went wrong</h3><p>Detailed error messages are not stored.</p></div></div><div class="card-body">${body}</div></section>`;
}

function failureCategoryRow(row, max) {
  const label = failureCategoryLabel(row?.category);
  const failures = Math.max(0, Number(row?.failures || 0));
  return `<div class="usage-bar-row"><span class="usage-bar-label" title="${esc(label)}">${esc(label)}</span><progress max="${max}" value="${failures}">${integer(failures)}</progress><strong>${integer(failures)}</strong></div>`;
}

function failureCategoryLabel(category) {
  return ({ cancelled: 'Cancelled', timeout: 'Timed out', authorization: 'Sign-in', capacity: 'Busy', transport: 'Connection', policy: 'Safety rule', workspace: 'Project folder', git: 'Git', process: 'Command', validation: 'Input or check', runtime: 'App' })[String(category || '').toLowerCase()] || 'App';
}

function activityBarsSection(title,rows,key){const visible=[...rows].sort((a,b)=>b.toolCalls-a.toolCalls).slice(0,10);const max=Math.max(1,...visible.map(row=>row.toolCalls));const body=visible.length?`<div class="usage-bar-list">${visible.map(row=>bar(row,key,max)).join('')}</div>`:'<div class="usage-breakdown-empty">No activity in this range.</div>';return `<section class="card usage-breakdown usage-bar-card"><div class="card-head"><h3>${esc(title)}</h3></div><div class="card-body">${body}</div></section>`;}
function bar(row,key,max){const label=key==='workspace'?(row.workspace||'Unattributed'):(row.tool||'Unknown tool');const inner=`<span class="usage-bar-label" title="${esc(label)}">${esc(label)}</span><progress max="${max}" value="${row.toolCalls}">${integer(row.toolCalls)}</progress><strong>${integer(row.toolCalls)}</strong>`;return key==='workspace'&&row.workspace?`<a class="usage-bar-row usage-bar-link" href="${routeHref('usage',{workspace:row.workspace})}">${inner}</a>`:`<div class="usage-bar-row">${inner}</div>`;}
function breakdownSection(title,rows,key){const body=rows.length?`<div class="usage-table-wrap"><table class="usage-table"><thead><tr><th scope="col">${esc(title.slice(0,-1))}</th><th scope="col">Actions</th><th scope="col">Successful</th><th scope="col">Failed</th><th scope="col">Execution time</th></tr></thead><tbody>${rows.map(row=>breakdownRow(row,key)).join('')}</tbody></table></div>`:'<div class="usage-breakdown-empty">No activity in this range.</div>';return `<section class="card usage-breakdown"><div class="card-head"><h3>${esc(title)}</h3></div><div class="card-body">${body}</div></section>`;}
function breakdownRow(row,key){const label=key==='device'?(row.displayName||shortId(row.deviceId)||'Unknown device'):(row[key]||'Unknown');return `<tr><th scope="row">${esc(label)}</th><td>${integer(row.toolCalls)}</td><td>${integer(row.successes)}</td><td>${integer(row.failures)}</td><td>${duration(row.executionMs)}</td></tr>`;}
function formatChartValue(value, metricLabel) {
  if (metricLabel === 'Reliable actions' || metricLabel === 'Successful actions' || metricLabel === 'Success rate') return percent(value);
  if (/duration|tool time|average time/i.test(metricLabel)) return duration(value);
  return integer(value);
}
function finite(values){return (values||[]).map(Number).map(value=>Number.isFinite(value)&&value>=0?value:0);}
function integer(value){return Math.floor(Number(value)||0).toLocaleString();}
function percent(value){const n=Number(value)||0;return `${n.toFixed(n>=10?1:2)}%`;}
function duration(value){const ms=Number(value)||0;if(ms<1000)return `${Math.floor(ms).toLocaleString()} ms`;const sec=ms/1000;if(sec<60)return `${sec.toFixed(sec>=10?1:2)} s`;const min=sec/60;if(min<60)return `${min.toFixed(min>=10?1:2)} min`;return `${(min/60).toFixed(2)} h`;}
function shortId(value){const text=String(value||'');return text.length>12?`${text.slice(0,8)}…${text.slice(-4)}`:text;}
