import { fetchJson, postJson } from '../../api.js';
import { pillHtml } from '../../components/pill.js';
import { toast } from '../../components/toast.js';
import { esc as escapeHtml } from '../../utils.js';
import { header, panel } from './shared.js';

const STATUS_URL = '/api/agents/chatgpt';
const AUTH_OPEN_URL = '/api/agents/chatgpt/auth/open';
const AUTH_FINISH_URL = '/api/agents/chatgpt/auth/finish';
const CANCEL_URL = '/api/agents/chatgpt/cancel';
const ACTIVE_AGENT_STATES = new Set(['pending', 'starting', 'working', 'input_required']);

export function mountSubagents(container) {
  container.innerHTML = '<div class="settings-loading">Loading ChatGPT subagent status…</div>';
  return loadAndRender(container);
}

async function loadAndRender(container) {
  const status = await fetchJson(STATUS_URL, { cache: 'no-store' });
  container.innerHTML = '';
  container.appendChild(header(
    'ChatGPT Subagents',
    'Sign in to the isolated ChatGPT browser Rel.AI uses for delegated agents. Your ChatGPT credentials stay inside that browser profile.'
  ));
  container.appendChild(authPanel(container, status).el);
  container.appendChild(agentsPanel(container, status).el);
}

function authPanel(container, status = {}) {
  const auth = panel('ChatGPT browser session');
  auth.el.classList.add('subagent-auth-panel');
  auth.body.setAttribute('aria-live', 'polite');
  if (!status?.ok) {
    auth.body.innerHTML = `<div class="connection-notice bad"><strong>Status unavailable</strong><p>${escapeHtml(status?.error || 'ChatGPT subagent status could not be loaded.')}</p></div>`;
    auth.body.appendChild(actionRow(container, status));
    return auth;
  }
  const view = chatGptAuthView(status.status);
  const browser = chatGptBrowserView(status.browser);
  const reasoning = normalizeReasoning(status.reasoning);
  auth.body.innerHTML = `
    <div class="subagent-auth-summary">
      <div class="subagent-auth-copy">
        <span class="application-update-label">Authentication</span>
        <strong>${escapeHtml(view.title)}</strong>
        <p>${escapeHtml(view.description)}</p>
      </div>
      ${pillHtml(view.label, view.tone)}
    </div>
    <div class="settings-fact-grid subagent-auth-facts">
      <div><span>Browser runtime</span><strong>${escapeHtml(browser.label)}</strong><small>${escapeHtml(browser.description)}</small></div>
      <div><span>Browser profile</span><strong>Isolated</strong><small>Cookies and credentials are not exposed through Rel.AI APIs.</small></div>
      <div><span>Last signed in</span><strong>${escapeHtml(formatAuthenticatedAt(status.authenticatedAt))}</strong><small>Recorded only after Rel.AI verifies the ChatGPT composer.</small></div>
      <div><span>Reasoning options</span><strong>${reasoning.length}</strong><small>Detected from the options visible to this ChatGPT account.</small></div>
    </div>
    <div class="subagent-reasoning" role="group" aria-labelledby="subagentReasoningLabel">
      <strong id="subagentReasoningLabel">Available reasoning</strong>
      <div class="subagent-reasoning-list">
        ${reasoning.length
          ? reasoning.map(level => `<span class="subagent-reasoning-chip">${escapeHtml(formatReasoningLabel(level))}</span>`).join('')
          : '<span class="muted">Sign in to detect the reasoning options available to this account.</span>'}
      </div>
    </div>
    ${browser.available ? '' : `<div class="settings-panel-intro">
      <strong>Local Chromium browser required</strong>
      <span>Install Chrome, Edge, or Chromium. Rel.AI uses an existing local browser and does not bundle another browser.</span>
    </div>`}
    <div class="settings-panel-intro">
      <strong>Temporary chats are mandatory</strong>
      <span>Rel.AI verifies Temporary Chat before sending a delegated prompt. If ChatGPT cannot confirm that mode or the requested reasoning option, the subagent is not started.</span>
    </div>`;
  auth.body.appendChild(actionRow(container, status));
  return auth;
}

function agentsPanel(container, status = {}) {
  const agents = normalizeAgents(status?.agents);
  const activeCount = agents.filter(agent => ACTIVE_AGENT_STATES.has(agent.status)).length;
  const section = panel('Delegated agents');
  section.el.classList.add('subagent-agents-panel');
  section.body.setAttribute('aria-live', 'polite');

  if (!status?.ok) {
    const unavailable = document.createElement('div');
    unavailable.className = 'connection-notice bad';
    unavailable.innerHTML = `<strong>Activity unavailable</strong><p>${escapeHtml(status?.error || 'Delegated agent activity could not be loaded.')}</p>`;
    section.body.appendChild(unavailable);
    return section;
  }

  const summary = document.createElement('div');
  summary.className = 'subagent-agents-summary';
  summary.innerHTML = `
    <div>
      <span class="application-update-label">Activity</span>
      <strong>${activeCount ? `${activeCount} active` : 'No active agents'}</strong>
      <p>${agents.length ? `Showing ${agents.length} active or recent delegated agent${agents.length === 1 ? '' : 's'}.` : 'Delegated agents will appear here after ChatGPT starts one.'}</p>
    </div>`;
  summary.appendChild(actionButton('Refresh', 'secondary', () => loadAndRender(container)));
  section.body.appendChild(summary);

  if (!agents.length) {
    const empty = document.createElement('div');
    empty.className = 'subagent-agents-empty';
    empty.textContent = 'No delegated agents yet.';
    section.body.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'subagent-agent-list';
  for (const agent of agents) list.appendChild(agentCard(container, agent));
  section.body.appendChild(list);
  return section;
}

function agentCard(container, agent) {
  const card = document.createElement('article');
  card.className = 'subagent-agent-card';
  const statusView = agentStatusView(agent.status);
  const objective = displayText(agent.objective, 500) || 'Delegated task';
  const resultSummary = displayText(agent?.agentResult?.summary, 600);
  const error = displayText(agent.error, 600);
  const metadata = [
    formatRoleLabel(agent.role),
    formatReasoningLabel(agent.reasoning),
    String(agent.workspace || '').trim()
  ].filter(Boolean);

  card.innerHTML = `
    <div class="subagent-agent-card-head">
      <div class="subagent-agent-title">
        <strong>${escapeHtml(objective)}</strong>
        <span>${escapeHtml(metadata.join(' · '))}</span>
      </div>
      ${pillHtml(statusView.label, statusView.tone)}
    </div>
    <div class="subagent-agent-timing">
      <span>Updated ${escapeHtml(formatAgentTimestamp(agent.updatedAt || agent.createdAt))}</span>
      ${agent.completedAt ? `<span>Finished ${escapeHtml(formatAgentTimestamp(agent.completedAt))}</span>` : ''}
    </div>
    ${resultSummary ? `<div class="subagent-agent-outcome"><strong>Result</strong><p>${escapeHtml(resultSummary)}</p></div>` : ''}
    ${error ? `<div class="subagent-agent-outcome"><strong>${agent.status === 'cancelled' ? 'Cancellation' : 'Outcome'}</strong><p>${escapeHtml(error)}</p></div>` : ''}`;

  if (ACTIVE_AGENT_STATES.has(agent.status)) {
    const actions = document.createElement('div');
    actions.className = 'subagent-agent-actions';
    const cancel = actionButton('Cancel', 'secondary', () => cancelAgent(container, agent.agent_id));
    cancel.setAttribute('aria-label', `Cancel subagent: ${displayText(objective, 120)}`);
    actions.appendChild(cancel);
    card.appendChild(actions);
  }
  return card;
}

function actionRow(container, status = {}) {
  const row = document.createElement('div');
  row.className = 'connection-actions subagent-auth-actions';
  const state = String(status.status || 'not_authenticated');
  const browser = chatGptBrowserView(status.browser);
  if (!browser.available) {
    row.appendChild(actionButton('Check browser again', 'secondary', () => loadAndRender(container)));
    const hint = document.createElement('span');
    hint.className = 'muted subagent-auth-action-hint';
    hint.textContent = 'Install Chrome, Edge, or Chromium first.';
    row.appendChild(hint);
    return row;
  }
  if (state === 'authentication_open') {
    row.appendChild(actionButton('Check sign-in', 'primary', () => finishAuthentication(container)));
    const hint = document.createElement('span');
    hint.className = 'muted subagent-auth-action-hint';
    hint.textContent = 'Finish signing in in the ChatGPT window, then check again.';
    row.appendChild(hint);
    return row;
  }
  const label = ['authentication_saved', 'authenticated'].includes(state) ? 'Re-authenticate' : 'Open ChatGPT sign-in';
  row.appendChild(actionButton(label, 'primary', () => openAuthentication(container)));
  return row;
}

function actionButton(label, className, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.onclick = async () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await action();
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  };
  return button;
}

async function openAuthentication(container) {
  const result = await postJson(AUTH_OPEN_URL, {}, { timeout: 30_000, cache: 'no-store' });
  if (!result?.ok) {
    toast(result?.error || 'ChatGPT sign-in window could not be opened.', { variant: 'error' });
    return;
  }
  toast('ChatGPT sign-in window opened.', { variant: 'info' });
  await loadAndRender(container);
}

async function finishAuthentication(container) {
  const result = await postJson(AUTH_FINISH_URL, {}, { timeout: 30_000, cache: 'no-store' });
  if (!result?.ok) {
    toast(result?.error || 'ChatGPT sign-in is not complete yet.', { variant: 'error' });
    await loadAndRender(container);
    return;
  }
  toast('ChatGPT subagent sign-in verified.', { variant: 'success' });
  await loadAndRender(container);
}

async function cancelAgent(container, agentId) {
  const result = await postJson(CANCEL_URL, { agent_id: agentId }, { timeout: 30_000, cache: 'no-store' });
  if (!result?.ok) {
    toast(result?.error || 'Delegated agent could not be cancelled.', { variant: 'error' });
    await loadAndRender(container);
    return;
  }
  toast('Delegated agent cancelled.', { variant: 'success' });
  await loadAndRender(container);
}

export function chatGptAuthView(status) {
  switch (String(status || '')) {
    case 'authentication_saved':
    case 'authenticated':
      return { label: 'Sign-in saved', tone: 'ok', title: 'Verified ChatGPT profile saved', description: 'Rel.AI last verified this isolated profile at sign-in and checks authentication again before each delegated agent starts.' };
    case 'authentication_open':
      return { label: 'Sign-in open', tone: 'working', title: 'Complete sign-in in ChatGPT', description: 'A visible ChatGPT window is open for manual authentication.' };
    case 'unsupported':
      return { label: 'Unavailable', tone: 'warn', title: 'Interactive sign-in is unavailable', description: 'This agent runtime does not support ChatGPT browser authentication.' };
    default:
      return { label: 'Not signed in', tone: 'warn', title: 'Sign in before using ChatGPT subagents', description: 'Open the isolated ChatGPT window and sign in with the account you want delegated agents to use.' };
  }
}

export function chatGptBrowserView(browser = {}) {
  if (browser?.available === true) {
    const product = String(browser.product || '').trim() || 'Chromium';
    return {
      available: true,
      label: product,
      description: `Rel.AI will use ${product} for isolated ChatGPT subagent sessions.`
    };
  }
  return {
    available: false,
    label: 'Unavailable',
    description: 'Install Chrome, Edge, or Chromium. Rel.AI uses an existing local browser and does not bundle another browser.'
  };
}

export function agentStatusView(status) {
  switch (String(status || '').trim().toLowerCase()) {
    case 'pending': return { label: 'Starting', tone: 'working' };
    case 'starting': return { label: 'Starting', tone: 'working' };
    case 'working': return { label: 'Working', tone: 'working' };
    case 'input_required': return { label: 'Needs input', tone: 'warn' };
    case 'completed': return { label: 'Completed', tone: 'ok' };
    case 'failed': return { label: 'Failed', tone: 'bad' };
    case 'cancelled': return { label: 'Cancelled', tone: 'warn' };
    default: return { label: 'Unknown', tone: 'warn' };
  }
}

export function formatReasoningLabel(value) {
  const labels = { instant: 'Instant', medium: 'Medium', high: 'High', extra_high: 'Extra High', pro: 'Pro' };
  return labels[String(value || '').trim().toLowerCase()] || String(value || '').trim();
}

export function formatAgentTimestamp(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function formatRoleLabel(value) {
  const role = String(value || '').trim().replaceAll('_', ' ');
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : '';
}

function normalizeAgents(value) {
  return (Array.isArray(value) ? value : []).filter(agent => agent && typeof agent === 'object');
}

function normalizeReasoning(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function displayText(value, maxChars) {
  const text = String(value || '').trim();
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function formatAuthenticatedAt(value) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not yet' : date.toLocaleString();
}
