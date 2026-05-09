import { fetchJson } from '/ui/api.js';
import { esc } from '/ui/utils.js';

export function mountDiagnostics(container) {
  container.innerHTML = '';
  const head = document.createElement('div');
  head.style.cssText = 'display:grid;gap:4px;margin-bottom:14px;';
  head.innerHTML = '<h3 style="margin:0;font-size:15px;">Diagnostics</h3><p style="margin:0;color:var(--text-muted);font-size:13px;">Plain-language checks first. Raw JSON is still available for debugging.</p>';
  container.appendChild(head);

  const cards = document.createElement('div');
  cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;max-width:980px;';
  container.appendChild(cards);

  const raw = document.createElement('pre');
  raw.style.cssText = 'background:var(--bg);border:1px solid var(--line-soft);border-radius:8px;padding:12px;font-size:12px;overflow:auto;max-height:340px;margin-top:14px;display:none;';
  container.appendChild(raw);

  loadAll(cards, raw);
}

async function loadAll(cards, raw) {
  cards.innerHTML = '<div class="empty">Loading diagnostics…</div>';
  const [health, readiness, logs] = await Promise.all([
    fetchJson('/api/health-monitor'),
    fetchJson('/api/readiness?requireHttpToken=0'),
    fetchJson('/api/logs?limit=50')
  ]);
  cards.innerHTML = '';
  cards.appendChild(summaryCard('Health', health && health.ok !== false ? 'All clear' : 'Needs attention', health && health.findings, raw, health));
  cards.appendChild(summaryCard('Readiness', readiness && readiness.score != null ? readiness.score + '/100' : 'Unknown', readiness && readiness.findings, raw, readiness));
  const entries = logs && Array.isArray(logs.entries) ? logs.entries : [];
  cards.appendChild(activityCard(entries, raw, logs));
}

function summaryCard(title, value, findings, raw, payload) {
  const card = document.createElement('div');
  card.className = 'card';
  const list = Array.isArray(findings) ? findings : [];
  card.innerHTML = `<div class="card-head"><h3>${esc(title)}</h3><button class="secondary" style="min-height:24px;padding:0 8px;font-size:11px;">Raw</button></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.style.display = 'grid';
  body.style.gap = '8px';
  body.innerHTML = `<div style="font-size:22px;font-weight:800;color:${list.some(f => f.severity === 'error') ? 'var(--red)' : 'var(--green)'};">${esc(value)}</div>` +
    (list.length ? list.slice(0, 6).map(f => `<div style="font-size:12px;color:var(--text-muted);"><strong style="color:var(--text);">${esc(f.code || f.severity || 'finding')}</strong><br>${esc(f.message || '')}</div>`).join('') : '<div style="font-size:12px;color:var(--text-muted);">No findings.</div>');
  card.appendChild(body);
  card.querySelector('button').onclick = () => showRaw(raw, payload);
  return card;
}

function activityCard(entries, raw, payload) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="card-head"><h3>Recent activity</h3><button class="secondary" style="min-height:24px;padding:0 8px;font-size:11px;">Raw</button></div>';
  const body = document.createElement('div');
  body.className = 'card-body';
  body.style.display = 'grid';
  body.style.gap = '8px';
  body.innerHTML = `<div style="font-size:22px;font-weight:800;color:var(--blue);">${entries.length}</div><div style="font-size:12px;color:var(--text-muted);">Last ${entries.length} audit entries loaded.</div>`;
  card.appendChild(body);
  card.querySelector('button').onclick = () => showRaw(raw, payload);
  return card;
}

function showRaw(raw, payload) {
  raw.style.display = 'block';
  raw.textContent = JSON.stringify(payload, null, 2);
}
