import { fetchJson } from '/ui/api.js';
export function mountDiagnostics(container) {
  container.innerHTML = '<h3 style="margin:0 0 16px;font-size:15px;">Diagnostics</h3>';
  const btns = [['Health monitor', '/api/health-monitor'], ['Readiness', '/api/readiness?requireHttpToken=0'], ['Audit tail', '/api/logs?limit=100']];
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;gap:8px;';
  const pre = document.createElement('pre');
  pre.style.cssText = 'background:var(--bg);border:1px solid var(--line-soft);border-radius:8px;padding:12px;font-size:12px;overflow:auto;max-height:400px;margin-top:12px;';
  pre.textContent = 'Select a diagnostic view.';
  for (const [label, url] of btns) {
    const btn = document.createElement('button');
    btn.className = 'secondary'; btn.textContent = label;
    btn.onclick = async () => { btn.disabled = true; btn.textContent = 'Loading…'; const data = await fetchJson(url); pre.textContent = JSON.stringify(data, null, 2); btn.disabled = false; btn.textContent = label; };
    grid.appendChild(btn);
  }
  container.appendChild(grid);
  container.appendChild(pre);
}
