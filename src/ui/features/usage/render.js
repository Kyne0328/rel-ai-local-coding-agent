import { routeHref } from '../../router.js';
import { deltaFor } from './range-model.js';

export function renderUsage(content, { bounds, current, previous, allCurrent }) {
  const local = current.source === 'local';
  const scopeCopy = current.kind === 'workspace'
    ? (local
      ? `Showing device-local aggregate tool activity attributed to ${current.label}. No repository paths or tool result bodies are stored in analytics.`
      : `Showing exact tool activity attributed to ${current.label}${current.deviceId ? ' on the selected device' : ''}. Transport byte totals remain principal-wide and are not mixed into workspace cards.`)
    : (local
      ? 'This view uses privacy-safe aggregates recorded on this device. Prompts, repository contents, paths, command output, and tool result bodies are not stored in analytics.'
      : 'Counts and byte totals are recorded by the Rel.AI gateway from authenticated MCP traffic. They do not represent ChatGPT model-token usage or billing.');
  const fallback = current.usedMonthlyFallback && current.points.every(point => point.toolCalls === 0 && point.requests === 0)
    ? '<p class="usage-series-note">This month includes legacy monthly totals recorded before hourly trends were available. Trend lines begin with newly bucketed activity.</p>' : '';
  content.innerHTML = `
    <section class="usage-overview" aria-label="${esc(current.label)} analytics for ${esc(bounds.label)}">
      <div class="usage-month-summary"><div><span class="field-caption">${current.kind === 'workspace' ? 'Workspace analytics' : 'Analytics range'}</span><strong>${esc(current.kind === 'workspace' ? current.label : bounds.label)}</strong><small>${esc(bounds.label)} · UTC</small></div><p>${esc(scopeCopy)}</p></div>
      ${fallback}
      <div class="usage-metrics">${analyticsMetrics(current, previous).map(metricHtml).join('')}</div>
      ${transportFacts(current, allCurrent)}
    </section>
    ${timelineSection(current)}
    <div class="usage-visual-grid">${outcomesSection(current)}${activityBarsSection('Tool usage', current.kind === 'workspace' ? 'Tools used in this workspace during the selected range.' : 'Exact tool calls during the selected range.', current.tools, 'tool')}</div>
    ${current.failures ? failureCategoriesSection(current.failureCategories) : ''}
    ${current.kind === 'workspace'
      ? `${breakdownSection('Devices', 'Devices that contributed activity to this workspace in the selected range.', current.devices, 'device')}${workspaceComparisonSection(allCurrent.workspaces, current.label)}`
      : activityBarsSection('Workspace activity', 'Workspace aliases with observed activity during the selected range.', current.workspaces, 'workspace')}`;
  wireTimeline(content, current);
}

function analyticsMetrics(scope, previous) {
  const values = key => scope.points.map(point => pointMetric(point, key));
  const compare = (key, options = {}) => scope.usedMonthlyFallback ? null : deltaFor(scope, previous, key, options);
  const metric = (label, key, value, detail, options = {}) => ({ label, value, detail, delta: compare(key, options), values: values(options.sparkKey || key), tone: options.metricTone || '' });
  if (scope.kind !== 'workspace' && scope.source === 'local') return [
    metric('Tool calls', 'toolCalls', integer(scope.toolCalls), 'Completed local invocations', { neutral: true }),
    metric('Successful', 'successes', integer(scope.successes), 'Completed successfully'),
    metric('Success rate', 'successRate', percent(scope.successRate), `${integer(scope.completed)} completed outcomes`, { rate: true, sparkKey: 'successRate' }),
    metric('Failed', 'failures', integer(scope.failures), scope.failures ? 'Needs attention' : 'No recorded failures', { inverse: true, metricTone: scope.failures ? 'bad' : 'good' }),
    metric('Avg tool time', 'averageDuration', duration(scope.averageDuration), scope.completed ? 'Per completed tool call' : 'No completed outcomes', { inverse: true, sparkKey: 'averageDuration' }),
    metric('Active days', 'activeDays', integer(scope.activeDays), 'UTC days with local activity', { neutral: true, sparkKey: 'toolCalls' })
  ];
  if (scope.kind === 'workspace') return [
    metric('Tool calls', 'toolCalls', integer(scope.toolCalls), 'Exact invocations', { neutral: true }),
    metric('Successful', 'successes', integer(scope.successes), 'Completed successfully'),
    metric('Failed', 'failures', integer(scope.failures), scope.failures ? 'Needs attention' : 'No recorded failures', { inverse: true, metricTone: scope.failures ? 'bad' : 'good' }),
    metric('Success rate', 'successRate', percent(scope.successRate), `${integer(scope.completed)} completed outcomes`, { rate: true, sparkKey: 'successRate' }),
    metric('Execution time', 'executionMs', duration(scope.executionMs), 'Completed tool duration', { neutral: true }),
    metric('Avg tool time', 'averageDuration', duration(scope.averageDuration), scope.completed ? 'Per completed tool call' : 'No completed outcomes', { inverse: true, sparkKey: 'averageDuration' })
  ];
  return [
    metric('MCP requests', 'requests', integer(scope.requests), 'Authenticated requests', { neutral: true }),
    metric('Tool calls', 'toolCalls', integer(scope.toolCalls), 'Exact invocations', { neutral: true }),
    metric('Success rate', 'successRate', percent(scope.successRate), `${integer(scope.completed)} completed outcomes`, { rate: true, sparkKey: 'successRate' }),
    metric('Failed', 'failures', integer(scope.failures), scope.failures ? 'Needs attention' : 'No recorded failures', { inverse: true, metricTone: scope.failures ? 'bad' : 'good' }),
    metric('Avg tool time', 'averageDuration', duration(scope.averageDuration), scope.completed ? 'Per completed tool call' : 'No completed outcomes', { inverse: true, sparkKey: 'averageDuration' }),
    metric('Active days', 'activeDays', integer(scope.activeDays), 'UTC days with activity', { neutral: true, sparkKey: 'toolCalls' })
  ];
}

function metricHtml(metric) {
  const delta = metric.delta ? `<small class="usage-delta ${esc(metric.delta.tone || '')}">${esc(metric.delta.text)}</small>` : '<small class="usage-delta">Trend starts now</small>';
  return `<article class="usage-metric ${esc(metric.tone)}"><span>${esc(metric.label)}</span><div class="usage-metric-value"><strong>${esc(metric.value)}</strong>${delta}</div><small class="usage-metric-detail">${esc(metric.detail)}</small>${sparkline(metric.values, metric.tone)}</article>`;
}

function timelineSection(scope) {
  const switches = [['toolCalls', 'Tool calls'], ['failures', 'Errors'], ['successRate', 'Success rate'], ['averageDuration', 'Avg duration']];
  return `<section class="card usage-timeline-card" data-usage-timeline><div class="card-head usage-timeline-head"><div><h3>Activity over time</h3><p>Privacy-safe aggregate trend for the selected range.</p></div><div class="usage-chart-switch" role="group" aria-label="Chart metric">${switches.map(([key,label], i) => `<button type="button" class="secondary compact-button${i ? '' : ' active'}" data-usage-chart="${key}">${label}</button>`).join('')}</div></div><div class="card-body usage-timeline-body" data-usage-chart-body>${timeline(scope.points.map(point => pointMetric(point, 'toolCalls')))}</div></section>`;
}

function wireTimeline(content, scope) {
  const body = content.querySelector('[data-usage-chart-body]');
  content.querySelectorAll('[data-usage-chart]').forEach(button => button.addEventListener('click', () => {
    content.querySelectorAll('[data-usage-chart]').forEach(item => item.classList.toggle('active', item === button));
    if (body) body.innerHTML = timeline(scope.points.map(point => pointMetric(point, button.dataset.usageChart)));
  }));
}

function timeline(values) {
  const data = finite(values); const width = 720; const height = 180;
  if (!data.length || data.every(value => value === 0)) return '<div class="usage-chart-empty">No bucketed activity in this range yet.</div>';
  const max = Math.max(...data, 1);
  const points = data.map((value, i) => `${data.length === 1 ? width/2 : i/(data.length-1)*width},${height-12-value/max*(height-32)}`).join(' ');
  return `<svg class="usage-timeline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Activity trend"><line x1="0" y1="${height-12}" x2="${width}" y2="${height-12}" class="usage-chart-axis"/><polyline points="${points}" class="usage-chart-line" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
}

function sparkline(values, tone='') {
  const data=finite(values); const width=120; const height=28;
  if (!data.length) return '<span class="usage-sparkline-empty" aria-hidden="true"></span>';
  const max=Math.max(...data,1); const points=data.map((value,i)=>`${data.length===1?width/2:i/(data.length-1)*width},${height-2-value/max*(height-5)}`).join(' ');
  return `<svg class="usage-sparkline ${esc(tone)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
}

function pointMetric(point,key) {
  const completed=point.successes+point.failures;
  if(key==='successRate') return completed?point.successes/completed*100:0;
  if(key==='averageDuration') return completed?point.executionMs/completed:0;
  return Number(point[key]||0);
}

function transportFacts(scope, all) {
  if(scope.kind==='workspace') return `<div class="usage-fact-strip">${fact('Workspace share',percent(all.toolCalls?scope.toolCalls/all.toolCalls*100:0),'of observed tool calls')}${fact('Completed outcomes',integer(scope.completed),'successes + failures')}${fact('Source',scope.source==='local'?'This device':'Rel.AI Cloud',scope.source==='local'?'aggregate-only local data':'principal-wide Cloud data')}</div>`;
  if(scope.source==='local') return `<div class="usage-fact-strip">${fact('Storage','Local aggregate','no prompts, paths, or result bodies')}${fact('Completed outcomes',integer(scope.completed),'duration denominator')}${fact('Scope','This device','Cloud transport bytes kept separate')}</div>`;
  return `<div class="usage-fact-strip">${fact('Data sent',bytes(scope.requestBytes),'authenticated MCP payload bytes')}${fact('Data returned',bytes(scope.resultBytes),'gateway response bytes')}${fact('Completed outcomes',integer(scope.completed),'duration denominator')}</div>`;
}
function fact(label,value,detail){return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`;}
function outcomesSection(scope){return `<section class="card usage-visual-card"><div class="card-head"><div><h3>Outcomes</h3><p>Terminal outcomes for completed tool calls.</p></div><strong class="usage-visual-value">${percent(scope.successRate)}</strong></div><div class="card-body usage-outcomes"><progress class="usage-outcome-progress" max="${Math.max(1,scope.completed)}" value="${scope.successes}">${percent(scope.successRate)}</progress><div class="usage-outcome-legend">${legend('Successful',scope.successes,'good')}${legend('Failed',scope.failures,'bad')}</div></div></section>`;}
function legend(label,value,tone){return `<div class="${tone}"><span><i aria-hidden="true"></i>${esc(label)}</span><strong>${integer(value)}</strong></div>`;}

function failureCategoriesSection(rows) {
  const visible = [...(rows || [])].sort((a, b) => b.failures - a.failures).slice(0, 10);
  const max = Math.max(1, ...visible.map(row => row.failures));
  const body = visible.length
    ? `<div class="usage-bar-list">${visible.map(row => failureCategoryRow(row, max)).join('')}</div>`
    : '<div class="usage-breakdown-empty">Category detail is unavailable for older failures recorded before normalized categories were added.</div>';
  return `<section class="card usage-breakdown usage-bar-card"><div class="card-head"><div><h3>Failure categories</h3><p>Normalized categories only. Raw error codes and messages are not stored in analytics.</p></div></div><div class="card-body">${body}</div></section>`;
}

function failureCategoryRow(row, max) {
  const label = failureCategoryLabel(row?.category);
  const failures = Math.max(0, Number(row?.failures || 0));
  return `<div class="usage-bar-row"><span class="usage-bar-label" title="${esc(label)}">${esc(label)}</span><progress max="${max}" value="${failures}">${integer(failures)}</progress><strong>${integer(failures)}</strong></div>`;
}

function failureCategoryLabel(category) {
  return ({ cancelled: 'Cancelled', timeout: 'Timeout', authorization: 'Authorization', capacity: 'Capacity', transport: 'Transport', policy: 'Policy / safety', workspace: 'Workspace / path', git: 'Git', process: 'Process / command', validation: 'Validation / input', runtime: 'Runtime' })[String(category || '').toLowerCase()] || 'Runtime';
}

function workspaceComparisonSection(rows, selected) {
  const current=rows.find(row=>row.workspace===selected)||{toolCalls:0}; const total=rows.reduce((sum,row)=>sum+row.toolCalls,0); const rank=rows.length?[...rows].sort((a,b)=>b.toolCalls-a.toolCalls).findIndex(row=>row.workspace===selected)+1:0;
  return `<section class="card usage-visual-card"><div class="card-head"><div><h3>Workspace position</h3><p>Relative activity for the selected range.</p></div></div><div class="card-body usage-workspace-summary">${fact('Tool-call share',percent(total?current.toolCalls/total*100:0),'of attributed calls')}${fact('Activity rank',rank?`#${rank}`:'—',`${integer(rows.length)} active workspace${rows.length===1?'':'s'}`)}</div></section>`;
}

function activityBarsSection(title,description,rows,key){const visible=[...rows].sort((a,b)=>b.toolCalls-a.toolCalls).slice(0,10);const max=Math.max(1,...visible.map(row=>row.toolCalls));const body=visible.length?`<div class="usage-bar-list">${visible.map(row=>bar(row,key,max)).join('')}</div>`:'<div class="usage-breakdown-empty">No recorded activity for this range.</div>';return `<section class="card usage-breakdown usage-bar-card"><div class="card-head"><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div></div><div class="card-body">${body}</div></section>`;}
function bar(row,key,max){const label=key==='workspace'?(row.workspace||'Unattributed'):(row.tool||'Unknown tool');const inner=`<span class="usage-bar-label" title="${esc(label)}">${esc(label)}</span><progress max="${max}" value="${row.toolCalls}">${integer(row.toolCalls)}</progress><strong>${integer(row.toolCalls)}</strong>`;return key==='workspace'&&row.workspace?`<a class="usage-bar-row usage-bar-link" href="${routeHref('usage',{workspace:row.workspace})}">${inner}</a>`:`<div class="usage-bar-row">${inner}</div>`;}
function breakdownSection(title,description,rows,key){const body=rows.length?`<div class="usage-table-wrap"><table class="usage-table"><thead><tr><th scope="col">${esc(title.slice(0,-1))}</th><th scope="col">Tool calls</th><th scope="col">Successful</th><th scope="col">Failed</th><th scope="col">Execution time</th></tr></thead><tbody>${rows.map(row=>breakdownRow(row,key)).join('')}</tbody></table></div>`:'<div class="usage-breakdown-empty">No recorded activity for this range.</div>';return `<section class="card usage-breakdown"><div class="card-head"><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div></div><div class="card-body">${body}</div></section>`;}
function breakdownRow(row,key){const label=key==='device'?(row.displayName||shortId(row.deviceId)||'Unknown device'):(row[key]||'Unknown');return `<tr><th scope="row">${esc(label)}</th><td>${integer(row.toolCalls)}</td><td>${integer(row.successes)}</td><td>${integer(row.failures)}</td><td>${duration(row.executionMs)}</td></tr>`;}
function finite(values){return (values||[]).map(Number).map(value=>Number.isFinite(value)&&value>=0?value:0);}
function integer(value){return Math.floor(Number(value)||0).toLocaleString();}
function percent(value){const n=Number(value)||0;return `${n.toFixed(n>=10?1:2)}%`;}
function bytes(value){const n=Number(value)||0;if(n<1024)return `${Math.floor(n).toLocaleString()} B`;const units=['KiB','MiB','GiB','TiB'];let amount=n,unit=-1;do{amount/=1024;unit+=1;}while(amount>=1024&&unit<units.length-1);return `${amount>=100?amount.toFixed(0):amount>=10?amount.toFixed(1):amount.toFixed(2)} ${units[unit]}`;}
function duration(value){const ms=Number(value)||0;if(ms<1000)return `${Math.floor(ms).toLocaleString()} ms`;const sec=ms/1000;if(sec<60)return `${sec.toFixed(sec>=10?1:2)} s`;const min=sec/60;if(min<60)return `${min.toFixed(min>=10?1:2)} min`;return `${(min/60).toFixed(2)} h`;}
function shortId(value){const text=String(value||'');return text.length>12?`${text.slice(0,8)}…${text.slice(-4)}`:text;}
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);}
