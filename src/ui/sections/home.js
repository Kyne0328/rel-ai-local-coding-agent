// Home section — simple ChatGPT-local-repo overview
import { pillHtml } from '/ui/components/pill.js';
import { esc, metricHtml, timeAgo } from '/ui/utils.js';

export function mountHome(container, data) {
  if (!data) return;
  container.innerHTML = '';
  container.appendChild(buildHome(data));
}

function buildHome(data) {
  const cfg = data.config || {};
  const health = data.health || {};
  const audit = sortedAudit(data.auditTail && data.auditTail.entries);
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const workspaces = Array.isArray(cfg.workspaces) ? cfg.workspaces : [];
  const findings = Array.isArray(health.findings) ? health.findings.filter(f => f.severity !== 'info') : [];
  const staleHours = Number((cfg.productUx && cfg.productUx.staleHours) || health.staleHours || 24);
  const currentSessions = sessions.filter(s => isCurrentWork(s, staleHours));
  const runningJobs = jobs.filter(j => ['running', 'queued', 'cancelling'].includes(String(j.status || '').toLowerCase()) && !isOlderThan(j.updatedAt || j.startedAt, staleHours));

  updateShell(data, cfg);

  const root = document.createElement('div');
  root.className = 'section';

  const totalCautions = workspaces.reduce((n, w) => n + ((w.caution && Number.isFinite(w.caution.count)) ? w.caution.count : 0), 0);

  const metrics = document.createElement('div');
  metrics.className = 'overview-grid';
  metrics.innerHTML =
    metricHtml('Workspaces', workspaces.length, 'configured repositories', 'blue') +
    metricHtml('Health', findings.length, health.ok === false ? 'needs attention' : 'all clear', health.ok === false ? 'bad' : 'good') +
    metricHtml('Validation', validationSummary(workspaces), 'workspaces with a saved or detected test command', 'blue') +
    metricHtml('Cautions 24h', totalCautions, 'caution-zone events in the last day', totalCautions > 0 ? 'warn' : 'good');
  root.appendChild(metrics);

  root.appendChild(releaseNotesCard());

  root.appendChild(nextStepsCard(workspaces, findings, audit));

  const grid = document.createElement('div');
  grid.className = 'layout-grid';
  grid.appendChild(workspaceSetupCard(workspaces));
  grid.appendChild(recentActivityCard(audit));
  root.appendChild(grid);

  const current = currentWorkCard(currentSessions, runningJobs, staleHours);
  root.appendChild(current);

  return root;
}

function updateShell(data, cfg) {
  const subtitle = document.getElementById('subtitle');
  if (subtitle) subtitle.textContent = `Rel.AI MCP · ChatGPT workspace bridge · ${Array.isArray(cfg.workspaces) ? cfg.workspaces.length : 0} workspaces`;
  const updated = document.getElementById('lastUpdated');
  if (updated) updated.textContent = 'Updated ' + new Date().toLocaleTimeString();
  const statusEl = document.getElementById('serverStatus');
  if (statusEl) {
    statusEl.className = 'status-pill ' + (data.ok ? 'ok' : 'bad');
    statusEl.textContent = data.ok ? 'Online' : 'Error';
  }
}

function releaseNotesCard() {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="card-head"><h3>What\'s new</h3></div>';
  const body = document.createElement('div');
  body.className = 'card-body stack-tight';
  body.innerHTML = '<div class="release-note-meta">Loading release notes…</div>';
  card.appendChild(body);

  import('/ui/api.js').then(({ fetchJson }) => fetchJson('/api/release-notes').then(notes => {
    if (!notes) { body.innerHTML = '<div class="release-note-meta">No release notes available.</div>'; return; }
    const safeVersion = esc(notes.version || '');
    const safeHeadline = esc(notes.headline || '');
    const bullets = Array.isArray(notes.bullets) ? notes.bullets : [];
    const bulletsHtml = bullets.map(b => `<li>${esc(b)}</li>`).join('');
    const versionLabel = safeVersion ? `v${safeVersion}` : 'Latest';
    body.innerHTML = `<div class="release-note"><strong>${versionLabel}</strong> — ${safeHeadline}</div><ul class="release-bullets">${bulletsHtml}</ul>`;
  })).catch(() => { body.innerHTML = '<div class="release-note-meta">Failed to load release notes.</div>'; });

  return card;
}

function nextStepsCard(workspaces, findings, audit) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="card-head"><h3>Next steps</h3><span class="section-action">best next move</span></div>';
  const body = document.createElement('div');
  body.className = 'card-body list';
  const steps = buildNextSteps(workspaces, findings, audit);
  body.innerHTML = steps.map(step => `
    <div class="list-item">
      <span class="dot ${esc(step.state || '')}"></span>
      <div>
        <div class="item-title">${esc(step.title)}</div>
        <div class="item-sub">${esc(step.description)}</div>
      </div>
      ${step.href ? `<a class="buttonlike secondary next-step-action" href="${esc(step.href)}">${esc(step.cta || 'Open')}</a>` : `<span class="section-action">${esc(step.cta || 'Ready')}</span>`}
    </div>
  `).join('');
  card.appendChild(body);
  return card;
}

function buildNextSteps(workspaces, findings, audit) {
  const actions = [];
  if (!workspaces.length) {
    actions.push({
      title: 'Add your first workspace',
      description: 'Nothing is available to ChatGPT until at least one local repository is configured.',
      href: '#workspaces',
      cta: 'Open workspaces',
      state: 'warn'
    });
  }

  const missingValidation = workspaces.filter(ws => !((ws.testCommandKeys || []).length || (ws.discoveredTestCommandKeys || []).length));
  if (missingValidation.length) {
    actions.push({
      title: 'Save a validation command',
      description: `${missingValidation.length} workspace${missingValidation.length === 1 ? '' : 's'} still lack a saved test or check command.`,
      href: '#workspaces',
      cta: 'Review validation',
      state: 'warn'
    });
  }

  if (findings.length) {
    actions.push({
      title: 'Review diagnostics',
      description: 'Rel.AI has health findings that may cause setup or runtime friction.',
      href: '#settings/diagnostics',
      cta: 'Open diagnostics',
      state: 'bad'
    });
  }

  if (!audit.length) {
    actions.push({
      title: 'Run a first task in ChatGPT',
      description: 'After setup, ask ChatGPT to inspect a file or run a workspace check so you can confirm the bridge end to end.',
      href: '#tools',
      cta: 'View tools',
      state: 'warn'
    });
  }

  if (!actions.length) {
    actions.push({
      title: 'The bridge is ready',
      description: 'Your workspace, validation, and recent activity all look healthy. The next step is just using it.',
      href: '#activity',
      cta: 'See activity',
      state: ''
    });
  }

  return actions.slice(0, 3);
}

function workspaceSetupCard(workspaces) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="card-head"><h3>Workspace setup</h3><span class="section-action">what ChatGPT can use</span></div>';
  const body = document.createElement('div');
  body.className = 'card-body list';
  body.innerHTML = workspaces.length ? workspaces.map(ws => {
    const configured = Array.isArray(ws.testCommandKeys) ? ws.testCommandKeys : [];
    const detected = Array.isArray(ws.discoveredTestCommandKeys) ? ws.discoveredTestCommandKeys : [];
    const status = detected.length || configured.length ? 'ready' : 'check';
    const label = configured.length ? `${configured.length} configured` : detected.length ? `${detected.length} auto-detected` : 'no validation found';
    return `<div class="list-item"><span class="dot ${status === 'ready' ? 'good' : 'warn'}"></span><div><div class="item-title">${esc(ws.alias || 'workspace')}</div><div class="item-sub">${esc(label)}${detected.length ? ' · ' + esc(detected.slice(0, 3).join(', ')) : ''}</div></div><div class="item-time">${pillHtml(status)}</div></div>`;
  }).join('') : '<div class="empty">No workspaces configured yet. Open <a href="#workspaces">Workspaces</a> to add your first repository.</div>';
  card.appendChild(body);
  return card;
}

function recentActivityCard(audit) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Recent activity</h3><span class="section-action">${audit.length} events</span></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = audit.slice(0, 12).map(x => {
    const ok = x.ok === false ? 'failed' : 'ok';
    return `<div class="activity-row"><span class="activity-time">${esc(timeAgo(x.ts || x.at || x.createdAt))}</span><span class="activity-name truncate mono">${esc(x.tool || x.type || 'activity')}</span>${pillHtml(ok)}</div>`;
  }).join('') || '<div class="empty">Activity will appear here when ChatGPT calls Rel.AI.</div>';
  card.appendChild(body);
  return card;
}

function currentWorkCard(sessions, jobs, staleHours) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Current work</h3><span class="section-action">active in last ${staleHours}h</span></div>`;
  const body = document.createElement('div');
  body.className = 'card-body list';
  const rows = [
    ...sessions.slice(0, 4).map(s => row(s.id, `${s.workspace || 'workspace'} · ${s.status || 'active'}`, s.updatedAt || s.createdAt, s.status)),
    ...jobs.slice(0, 4).map(j => row(j.id, `${j.workspace || 'workspace'} · ${j.commandKey || j.command || 'job'}`, j.updatedAt || j.startedAt, j.status))
  ];
  body.innerHTML = rows.join('') || '<div class="empty">No live work. Older stale sessions are hidden from this card and shown only in diagnostics.</div>';
  card.appendChild(body);
  return card;
}

function row(title, sub, ts, status) {
  return `<div class="list-item"><span class="dot"></span><div><div class="item-title">${esc(shortId(title))}</div><div class="item-sub">${esc(sub)}</div></div><div class="item-time">${pillHtml(status || timeAgo(ts))}</div></div>`;
}

function validationSummary(workspaces) {
  const ready = workspaces.filter(ws => (ws.testCommandKeys || []).length || (ws.discoveredTestCommandKeys || []).length).length;
  return `${ready}/${workspaces.length || 0}`;
}

function sortedAudit(entries) {
  return (Array.isArray(entries) ? [...entries] : []).sort((a, b) => Date.parse(b.ts || b.at || b.createdAt || 0) - Date.parse(a.ts || a.at || a.createdAt || 0));
}

function isCurrentWork(item, staleHours) {
  const status = String(item.status || '').toLowerCase();
  if (!['active', 'running', 'queued', 'needs-repair', 'in-progress'].includes(status)) return false;
  return !isOlderThan(item.updatedAt || item.createdAt, staleHours);
}

function isOlderThan(ts, hours) {
  const value = Date.parse(String(ts || ''));
  if (!Number.isFinite(value)) return true;
  return Date.now() - value > hours * 3600000;
}

function shortId(value) {
  const text = String(value || 'work');
  return text.length > 18 ? text.slice(0, 12) + '…' + text.slice(-5) : text;
}
