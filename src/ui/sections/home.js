import { pillHtml } from '../components/pill.js';
import { toast } from '../components/toast.js';
import { esc, metricHtml, timeAgo } from '../utils.js';

export function mountHome(container, data) {
  container.innerHTML = '';
  container.appendChild(buildOverview(data || {}));
}

function buildOverview(data) {
  const config = data.config || {};
  const health = data.health || {};
  const connection = data.connection || {};
  const workspaces = Array.isArray(config.workspaces) ? config.workspaces : [];
  const audit = sortedAudit(data.auditTail?.entries);
  const findings = actionableFindings(health);
  const endpoint = String(connection.chatgptMcpUrl || '');
  const validationReady = workspaces.filter(hasValidation).length;
  const bridgeState = resolveBridgeState({ endpoint, workspaces, findings });

  updateShell(data, workspaces.length);

  const root = document.createElement('div');
  root.className = 'section';
  root.appendChild(connectionHero(bridgeState, endpoint, connection, workspaces));

  const metrics = document.createElement('div');
  metrics.className = 'overview-grid overview-grid-compact';
  metrics.innerHTML =
    metricHtml('Workspaces', workspaces.length, 'repositories available to ChatGPT', workspaces.length ? 'blue' : 'warn') +
    metricHtml('Validation', `${validationReady}/${workspaces.length}`, 'workspaces with detected or saved checks', validationReady === workspaces.length && workspaces.length ? 'good' : 'warn') +
    metricHtml('Recent activity', audit.length, 'latest tool calls in the dashboard log', audit.length ? 'blue' : 'warn');
  root.appendChild(metrics);

  const attention = buildAttention(workspaces, findings, endpoint);
  if (attention.length) root.appendChild(attentionCard(attention));
  if (!audit.length && workspaces.length) root.appendChild(firstPromptCard(workspaces));

  const grid = document.createElement('div');
  grid.className = 'layout-grid';
  grid.appendChild(workspaceSummaryCard(workspaces));
  grid.appendChild(recentActivityCard(audit));
  root.appendChild(grid);
  return root;
}

function resolveBridgeState({ endpoint, workspaces, findings }) {
  if (!workspaces.length) {
    return {
      tone: 'warn',
      kicker: 'Workspace setup',
      title: 'Add a workspace to finish setup.',
      description: 'Rel.AI is running, but ChatGPT needs at least one configured repository before it can inspect or change local code.'
    };
  }
  if (!endpoint) {
    return {
      tone: 'warn',
      kicker: 'Secure connection',
      title: 'Publish the ChatGPT endpoint.',
      description: 'Your repositories are configured. Finish the connector setup so ChatGPT can reach this machine over HTTPS.'
    };
  }
  if (findings.length) {
    return {
      tone: 'bad',
      kicker: 'Needs attention',
      title: 'Rel.AI is connected, but diagnostics found a problem.',
      description: 'The endpoint is available, but one or more workspace or configuration findings should be resolved before relying on automated changes.'
    };
  }
  return {
    tone: 'good',
    kicker: 'Ready for ChatGPT',
    title: 'Your local workspace bridge is ready.',
    description: 'ChatGPT can use the secure MCP endpoint below to inspect, edit, validate, review, and restore your configured repositories.'
  };
}

function connectionHero(state, endpoint, connection, workspaces) {
  const hero = document.createElement('section');
  hero.className = `overview-hero ${state.tone}`;
  hero.innerHTML = `
    <div class="overview-copy">
      <div class="overview-kicker">${esc(state.kicker)}</div>
      <h2 class="overview-title">${esc(state.title)}</h2>
      <p class="overview-description">${esc(state.description)}</p>
      <div class="overview-actions">
        ${endpoint
          ? '<button class="primary" type="button" data-copy-mcp>Copy MCP endpoint</button>'
          : '<a class="buttonlike primary" href="#settings/connector">Open connector settings</a>'}
        <a class="buttonlike secondary" href="${workspaces.length ? '#activity' : '#workspaces'}">${workspaces.length ? 'View activity' : 'Add workspace'}</a>
      </div>
    </div>
    <div class="overview-endpoint">
      <div class="overview-endpoint-label">ChatGPT MCP endpoint</div>
      <div class="overview-endpoint-value ${endpoint ? '' : 'empty'}">${esc(endpoint || 'Waiting for a permanent HTTPS endpoint')}</div>
      <div class="overview-meta">${esc(connection.tunnelMode || 'Cloud connection required')}</div>
    </div>`;

  const copy = hero.querySelector('[data-copy-mcp]');
  if (copy) {
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(endpoint);
        toast('ChatGPT MCP endpoint copied.', { variant: 'success' });
      } catch {
        toast('Clipboard access failed. Copy the endpoint manually.', { variant: 'error' });
      }
    });
  }
  return hero;
}

function buildAttention(workspaces, findings, endpoint) {
  const items = [];
  if (!workspaces.length) {
    items.push({ tone: 'warn', title: 'No workspaces configured', copy: 'Add the repository aliases ChatGPT should be allowed to use.', href: '#workspaces', cta: 'Add workspace' });
  }
  const missingValidation = workspaces.filter(ws => !hasValidation(ws));
  if (missingValidation.length) {
    items.push({ tone: 'warn', title: 'Validation is incomplete', copy: `${missingValidation.length} workspace${missingValidation.length === 1 ? '' : 's'} have no saved or detected check command.`, href: '#workspaces', cta: 'Review validation' });
  }
  if (!endpoint) {
    items.push({ tone: 'warn', title: 'ChatGPT endpoint unavailable', copy: 'Configure the permanent HTTPS tunnel before creating the ChatGPT app.', href: '#settings/connector', cta: 'Open connector' });
  }
  if (findings.length) {
    items.push({ tone: 'bad', title: 'Diagnostics need review', copy: `${findings.length} actionable finding${findings.length === 1 ? '' : 's'} may affect workspace access or reliability.`, href: '#settings/diagnostics', cta: 'Open diagnostics' });
  }
  return items.slice(0, 3);
}

function attentionCard(items) {
  const card = document.createElement('section');
  card.className = 'card attention-card';
  card.innerHTML = '<div class="card-head"><h3>Needs attention</h3><span class="section-action">recommended next actions</span></div>';
  const body = document.createElement('div');
  body.className = 'card-body attention-list';
  body.innerHTML = items.map(item => `
    <div class="attention-item">
      <span class="attention-icon ${item.tone === 'bad' ? 'bad' : ''}"></span>
      <div><div class="attention-title">${esc(item.title)}</div><div class="attention-copy">${esc(item.copy)}</div></div>
      <a class="buttonlike secondary compact-button" href="${esc(item.href)}">${esc(item.cta)}</a>
    </div>`).join('');
  card.appendChild(body);
  return card;
}

function firstPromptCard(workspaces) {
  const alias = workspaces[0]?.alias || '<alias>';
  const prompt = `Use Rel.AI MCP. Call relai_repo_snapshot for workspace "${alias}". Do not modify files yet.`;
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = '<div class="card-head"><h3>Run a safe first task</h3><span class="section-action">paste into ChatGPT</span></div>';
  const body = document.createElement('div');
  body.className = 'card-body stack-tight';
  const text = document.createElement('div');
  text.className = 'first-prompt mono';
  text.textContent = prompt;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = 'Copy first prompt';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast('First prompt copied.', { variant: 'success' });
    } catch {
      toast('Clipboard access failed.', { variant: 'error' });
    }
  });
  body.append(text, button);
  card.appendChild(body);
  return card;
}

function workspaceSummaryCard(workspaces) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Workspaces</h3><a class="section-action" href="#workspaces">Manage</a></div>`;
  const body = document.createElement('div');
  body.className = 'card-body compact-workspace-list';
  body.innerHTML = workspaces.length
    ? workspaces.slice(0, 6).map(ws => `
      <div class="compact-workspace">
        <div><strong>${esc(ws.alias || 'workspace')}</strong><div class="compact-workspace-path">${esc(ws.path || '')}</div></div>
        ${pillHtml(hasValidation(ws) ? 'ready' : 'check')}
      </div>`).join('')
    : '<div class="empty">No workspaces configured. <a href="#workspaces">Add your first repository.</a></div>';
  card.appendChild(body);
  return card;
}

function recentActivityCard(audit) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Latest activity</h3><a class="section-action" href="#activity">View all</a></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = audit.slice(0, 8).map(entry => {
    const status = entry.ok === false ? 'failed' : 'ok';
    return `<div class="activity-row"><span class="activity-time">${esc(timeAgo(entry.ts || entry.at || entry.createdAt))}</span><span class="activity-name truncate mono">${esc(entry.tool || entry.type || 'activity')}</span>${pillHtml(status)}</div>`;
  }).join('') || '<div class="empty">Activity will appear after ChatGPT calls a Rel.AI tool.</div>';
  card.appendChild(body);
  return card;
}

function updateShell(data, workspaceCount) {
  const subtitle = document.getElementById('subtitle');
  if (subtitle) subtitle.textContent = `${workspaceCount} workspace${workspaceCount === 1 ? '' : 's'} available to ChatGPT`;
  const updated = document.getElementById('lastUpdated');
  if (updated) updated.textContent = data.generatedAt ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : '';
  const status = document.getElementById('serverStatus');
  if (status) {
    status.className = `status-pill ${data.ok === false ? 'bad' : 'ok'}`;
    status.textContent = data.ok === false ? 'Error' : 'Online';
  }
}

function hasValidation(workspace) {
  return Boolean((workspace.testCommandKeys || []).length || (workspace.discoveredTestCommandKeys || []).length);
}

function actionableFindings(health) {
  return Array.isArray(health.findings) ? health.findings.filter(item => item.severity !== 'info') : [];
}

function sortedAudit(entries) {
  return (Array.isArray(entries) ? [...entries] : []).sort((a, b) => Date.parse(b.ts || b.at || b.createdAt || 0) - Date.parse(a.ts || a.at || a.createdAt || 0));
}
