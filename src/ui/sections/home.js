import { pillHtml } from '../components/pill.js';
import { toast } from '../components/toast.js';
import { esc, metricHtml, timeAgo } from '../utils.js';
import { getWorkspaceFilter, routeHref } from '../router.js';

export function mountHome(container, data) {
  container.innerHTML = '';
  container.appendChild(buildOverview(data || {}));
}

function buildOverview(data) {
  const config = data.config || {};
  const health = data.health || {};
  const connection = data.connection || {};
  const workspaceFilter = getWorkspaceFilter();
  const allWorkspaces = Array.isArray(config.workspaces) ? config.workspaces : [];
  const workspaces = workspaceFilter ? allWorkspaces.filter(workspace => workspace.alias === workspaceFilter) : allWorkspaces;
  const tasks = (Array.isArray(data.tasks) ? data.tasks : []).filter(task => !workspaceFilter || task.workspace === workspaceFilter);
  const audit = sortedAudit(data.auditTail?.entries).filter(entry => !workspaceFilter || entry.workspace === workspaceFilter);
  const findings = actionableFindings(health);
  const endpoint = String(connection.chatgptMcpUrl || '');
  const validationReady = workspaces.filter(hasValidation).length;
  const bridgeState = resolveBridgeState({ endpoint, workspaces, findings });

  updateShell(data, workspaces.length);

  const root = document.createElement('div');
  root.className = 'section';
  const taskCard = taskActivityCard(data.taskActivity, tasks[0]);
  if (taskCard) root.appendChild(taskCard);
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
  if (!audit.some(entry => entry.ok !== false) && workspaces.length) root.appendChild(firstPromptCard(workspaces));

  const grid = document.createElement('div');
  grid.className = 'layout-grid';
  grid.appendChild(workspaceSummaryCard(workspaces));
  grid.appendChild(recentTasksCard(tasks));
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
    kicker: 'Connected and ready',
    title: 'Rel.AI can now receive workspace tasks from ChatGPT.',
    description: 'Your secure MCP connection is online. Open the dashboard to manage repositories and review task activity. Copy the endpoint only when adding or reconnecting Rel.AI in ChatGPT.'
  };
}

function connectionHero(state, endpoint, connection, workspaces) {
  const hero = document.createElement('section');
  const hasWorkspaces = workspaces.length > 0;
  const primaryAction = endpoint
    ? '<button class="primary" type="button" data-copy-mcp>Copy MCP endpoint</button>'
    : '<a class="buttonlike primary" href="#settings/connector">Open connector settings</a>';
  const secondaryRoute = hasWorkspaces ? routeHref('tasks') : routeHref('workspaces');
  const secondaryLabel = hasWorkspaces ? 'View tasks' : 'Add workspace';
  const endpointClass = endpoint ? '' : 'empty';
  hero.className = `overview-hero ${state.tone}`;
  hero.innerHTML = `
    <div class="overview-copy">
      <div class="overview-kicker">${esc(state.kicker)}</div>
      <h2 class="overview-title">${esc(state.title)}</h2>
      <p class="overview-description">${esc(state.description)}</p>
      <div class="overview-actions">
        ${primaryAction}
        <a class="buttonlike secondary" href="${secondaryRoute}">${secondaryLabel}</a>
      </div>
    </div>
    <div class="overview-endpoint">
      <div class="overview-endpoint-label">ChatGPT MCP endpoint</div>
      <div class="overview-endpoint-value ${endpointClass}">${esc(endpoint || 'Waiting for a permanent HTTPS endpoint')}</div>
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

function taskActivityCard(activity = {}, persistedTask = null) {
  const activeTasks = activeTaskList(activity);
  const active = activeTasks.length > 0;
  const task = active ? primaryActiveTask(activeTasks) : persistedTask || activity.lastTask;
  if (!task) return null;
  const card = document.createElement('section');
  if (active) renderActiveTaskCard(card, activity, activeTasks, task);
  else renderCompletedTaskCard(card, task);
  return card;
}

function activeTaskList(activity) {
  if (Array.isArray(activity.tasks)) return activity.tasks;
  if (activity.taskId && activity.state !== 'idle') return [activity];
  return [];
}

function primaryActiveTask(tasks) {
  return tasks.find(item => Number(item.activeCalls || 0) > 0) || tasks[0];
}

function renderActiveTaskCard(card, activity, activeTasks, task) {
  const taskCount = activeTasks.length;
  const activeCalls = Number(activity.activeCalls || activeTasks.reduce((sum, item) => sum + Number(item.activeCalls || 0), 0));
  const settling = activeCalls === 0;
  const location = activeTaskLocation(activeTasks);
  let title = 'ChatGPT is working.';
  if (settling) title = `${taskCount} open ${pluralLabel(taskCount, 'task')} waiting for follow-up calls.`;
  else if (taskCount > 1) title = `${taskCount} ChatGPT tasks are running.`;
  let description = `${esc(taskAction(task.lastTool || task.tool))} in <strong>${esc(task.workspace || location)}</strong>.`;
  if (taskCount > 1) description = `${activeCalls} ${pluralLabel(activeCalls, 'active tool call')} across ${location}.`;
  const activityLabel = settling
    ? 'Completes after 60s without another call'
    : `${activeCalls} ${pluralLabel(activeCalls, 'active call')}`;
  card.className = 'card task-overview active';
  card.innerHTML = `
    <div class="task-overview-mark" aria-hidden="true"></div>
    <div class="task-overview-copy">
      <div class="overview-kicker">ChatGPT activity</div>
      <h3>${title}</h3>
      <p>${description}</p>
    </div>
    <div class="task-overview-meta">
      <span>${activityLabel}</span>
      <strong>${formatDuration(Date.now() - Number(task.startedAt || Date.now()))}</strong>
    </div>`;
}

function renderCompletedTaskCard(card, task) {
  const attention = task.status === 'attention';
  const failed = Number(task.failures || 0);
  const callCount = Number(task.calls || 0);
  const mark = attention ? '!' : '✓';
  const title = attention ? 'Task needs attention' : 'Last task completed';
  const failureText = failed ? ` · ${failed} failed` : '';
  card.className = `card task-overview ${attention ? 'attention' : 'completed'}`;
  card.innerHTML = `
    <div class="task-overview-mark" aria-hidden="true">${mark}</div>
    <div class="task-overview-copy">
      <div class="overview-kicker">Previous task</div>
      <h3>${title}</h3>
      <p>${esc(task.workspace || 'workspace')} · ${callCount} ${pluralLabel(callCount, 'tool call')}${failureText}</p>
    </div>
    <div class="task-overview-meta"><span>${esc(timeAgo(task.completedAt))}</span><strong>${formatDuration(task.durationMs)}</strong></div>`;
}

function activeTaskLocation(tasks) {
  const workspaces = [...new Set(tasks.map(item => item.workspace).filter(Boolean))];
  if (workspaces.length === 1) return esc(workspaces[0]);
  if (workspaces.length > 1) return `${workspaces.length} workspaces`;
  return 'configured workspaces';
}

function pluralLabel(count, singular) {
  return Number(count) === 1 ? singular : `${singular}s`;
}

function taskAction(tool) {
  const value = String(tool || '');
  if (/run_checks|browser/.test(value)) return 'Validating changes';
  if (/diff|git_status/.test(value)) return 'Reviewing changes';
  if (/git_commit|git_push|git_create_pr/.test(value)) return 'Publishing changes';
  if (/edit|write|replace|tidy_run|restore/.test(value)) return 'Applying changes';
  return 'Inspecting the workspace';
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
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

function recentTasksCard(tasks) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h3>Recent tasks</h3><a class="section-action" href="${routeHref('tasks')}">View all</a></div>`;
  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = tasks.slice(0, 8).map(task => {
    const status = recentTaskStatus(task.status);
    const completedAt = task.completedAt ? timeAgo(task.completedAt) : 'now';
    return `<div class="activity-row"><span class="activity-time">${esc(completedAt)}</span><span class="activity-name truncate"><strong>${esc(task.workspace || 'workspace')}</strong> · ${esc(task.calls || 0)} calls · ${esc(task.changedFileCount || 0)} files</span>${pillHtml(status)}</div>`;
  }).join('') || '<div class="empty">Tasks will appear after ChatGPT calls a Rel.AI connector tool.</div>';
  card.appendChild(body);
  return card;
}

function recentTaskStatus(status) {
  if (status === 'attention') return 'failed';
  if (status === 'working' || status === 'settling') return 'check';
  return 'ok';
}

function updateShell(data, workspaceCount) {
  const subtitle = document.getElementById('subtitle');
  const task = data.taskActivity || {};
  if (subtitle && task.state === 'idle') subtitle.textContent = `${workspaceCount} workspace${workspaceCount === 1 ? '' : 's'} available to ChatGPT`;
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
