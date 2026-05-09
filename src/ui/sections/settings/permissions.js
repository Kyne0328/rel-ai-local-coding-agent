import { fetchJson } from '/ui/api.js';
export function mountPermissions(container) {
  container.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:13px;">Loading…</div>';
  _load(container);
}
async function _load(container) {
  const data = await fetchJson('/api/settings');
  if (!data || !data.ok) { container.innerHTML = '<div class="empty">Failed to load.</div>'; return; }
  container.innerHTML = '<h3 style="margin:0 0 16px;font-size:15px;">Permissions</h3>';
  const info = document.createElement('p');
  info.style.cssText = 'color:var(--text-muted);font-size:13px;';
  info.textContent = 'Full permissions editor — sandbox mode, Docker, GitHub CLI settings. Full implementation in Phase 3.';
  container.appendChild(info);
}
