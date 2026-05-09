// Approvals section — list, modal, approve/reject
import { fetchJson, postJson } from '/ui/api.js';
import { openModal, closeModal } from '/ui/components/modal.js';
import { toast } from '/ui/components/toast.js';

export function mountApprovals(container) {
  container.innerHTML = '';
  container.appendChild(_buildApprovals());
  _loadApprovals();
}

function _buildApprovals() {
  const root = document.createElement('div');
  root.className = 'section';
  root.innerHTML = '<div class="section-head"><h2>Approvals</h2></div>';
  const list = document.createElement('div');
  list.id = '__approvals-list';
  list.className = 'list';
  list.innerHTML = '<div class="empty">Loading approvals…</div>';
  root.appendChild(list);
  return root;
}

async function _loadApprovals() {
  const data = await fetchJson('/api/dashboard/v10?limit=20&requireHttpToken=0');
  const approvals = (data && Array.isArray(data.approvals)) ? data.approvals : [];
  _renderApprovals(approvals);
}

function _renderApprovals(approvals) {
  const list = document.getElementById('__approvals-list');
  if (!list) return;

  const pending = approvals.filter(x => !['approved', 'denied', 'resolved', 'cancelled'].includes(String(x.status || '').toLowerCase()));
  const resolved = approvals.filter(x => ['approved', 'denied', 'resolved', 'cancelled'].includes(String(x.status || '').toLowerCase()));

  if (!approvals.length) {
    list.innerHTML = '<div class="empty">No approval requests yet. Approvals appear when a tool requires explicit permission.</div>';
    return;
  }

  list.innerHTML = '';

  if (pending.length) {
    const heading = document.createElement('div');
    heading.style.cssText = 'font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:4px 0;';
    heading.textContent = 'Pending (' + pending.length + ')';
    list.appendChild(heading);
    for (const appr of pending) list.appendChild(_buildApprovalRow(appr, true));
  }

  if (resolved.length) {
    const heading = document.createElement('div');
    heading.style.cssText = 'font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:12px 0 4px;';
    heading.textContent = 'Resolved (' + resolved.length + ')';
    list.appendChild(heading);
    for (const appr of resolved.slice(0, 10)) list.appendChild(_buildApprovalRow(appr, false));
  }
}

function _buildApprovalRow(appr, isPending) {
  const row = document.createElement('div');
  row.className = 'list-item';
  row.style.cssText = isPending ? 'border-color:rgba(255,194,75,.25);background:rgba(255,194,75,.04);' : '';
  row.innerHTML = `
    <span class="dot ${isPending ? 'warn' : ''}"></span>
    <div>
      <div class="item-title">${esc(appr.action || 'approval')}</div>
      <div class="item-sub">${esc(appr.workspace || '')} · ${esc(appr.status || 'pending')} · ${_timeAgo(appr.createdAt)}</div>
    </div>
  `;

  if (isPending) {
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';
    const detailBtn = document.createElement('button');
    detailBtn.className = 'secondary';
    detailBtn.style.cssText = 'min-height:28px;padding:0 10px;font-size:12px;';
    detailBtn.textContent = 'Review';
    detailBtn.onclick = () => _openApprovalModal(appr, row);
    btns.appendChild(detailBtn);
    row.appendChild(btns);
  }
  return row;
}

function _openApprovalModal(appr, rowEl) {
  const content = document.createElement('div');
  content.style.cssText = 'display:grid;gap:14px;font-size:13px;';
  content.innerHTML = `
    <div style="display:grid;gap:8px;">
      ${[['Action', appr.action], ['Workspace', appr.workspace || '—'], ['Status', appr.status || 'pending'], ['Requested', new Date(appr.createdAt || '').toLocaleString()], ['Agent/Session', appr.sessionId || '—']].map(([k, v]) => `<div style="display:flex;gap:10px;"><span style="color:var(--text-muted);min-width:90px;">${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}
    </div>
  `;
  if (appr.args) {
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:var(--bg);border:1px solid var(--line-soft);border-radius:8px;padding:10px;font-size:12px;overflow:auto;max-height:160px;';
    pre.textContent = JSON.stringify(appr.args, null, 2);
    content.appendChild(pre);
  }

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:8px;';
  const approveBtn = document.createElement('button');
  approveBtn.textContent = 'Approve';
  approveBtn.style.cssText = 'background:rgba(71,221,138,.12);border-color:rgba(71,221,138,.35);';
  approveBtn.onclick = async () => {
    approveBtn.disabled = true; approveBtn.textContent = '…';
    const res = await postJson(`/api/approvals/${encodeURIComponent(appr.id)}/decision`, { status: 'approved' });
    if (res && res.ok) {
      closeModal();
      toast('Approved — approval ID copied to clipboard.', { variant: 'success' });
      try { await navigator.clipboard.writeText(appr.id); } catch (_) {}
      rowEl.remove();
    } else {
      toast('Error: ' + (res ? res.error : 'unknown'), { variant: 'error' });
      approveBtn.disabled = false; approveBtn.textContent = 'Approve';
    }
  };
  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'danger';
  rejectBtn.textContent = 'Reject';
  rejectBtn.onclick = async () => {
    rejectBtn.disabled = true; rejectBtn.textContent = '…';
    const res = await postJson(`/api/approvals/${encodeURIComponent(appr.id)}/decision`, { status: 'rejected' });
    if (res && res.ok) { closeModal(); toast('Rejected.', { variant: 'warn' }); rowEl.remove(); }
    else { toast('Error: ' + (res ? res.error : 'unknown'), { variant: 'error' }); rejectBtn.disabled = false; rejectBtn.textContent = 'Reject'; }
  };
  btnRow.appendChild(approveBtn);
  btnRow.appendChild(rejectBtn);
  content.appendChild(btnRow);

  openModal({ title: 'Review approval: ' + (appr.action || ''), content });
}

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function _timeAgo(v) { const ts = Date.parse(String(v || '')); if (!Number.isFinite(ts)) return ''; const m = Math.floor(Math.max(0, Date.now() - ts) / 60000); if (m < 1) return 'now'; if (m < 60) return m + 'm ago'; const h = Math.floor(m / 60); return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago'; }
