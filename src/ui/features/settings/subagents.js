import { fetchJson, postJson } from '../../api.js';
import { pillHtml } from '../../components/pill.js';
import { toast } from '../../components/toast.js';
import { esc as escapeHtml } from '../../utils.js';
import { header, panel } from './shared.js';
const STATUS_URL = '/api/agents/chatgpt';
const AUTH_OPEN_URL = '/api/agents/chatgpt/auth/open';
const AUTH_FINISH_URL = '/api/agents/chatgpt/auth/finish';
export function mountSubagents(container) {
  container.innerHTML = '<div class="settings-loading">Loading ChatGPT subagent statusÎ“Ã‡Âª</div>';
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
    <div class="settings-panel-intro">
      <strong>Temporary chats are mandatory</strong>
      <span>Rel.AI verifies Temporary Chat before sending a delegated prompt. If ChatGPT cannot confirm that mode or the requested reasoning option, the subagent is not started.</span>
    </div>`;
  auth.body.appendChild(actionRow(container, status));
  return auth;
}
function actionRow(container, status = {}) {
  const row = document.createElement('div');
  row.className = 'connection-actions subagent-auth-actions';
  const state = String(status.status || 'not_authenticated');
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
export function formatReasoningLabel(value) {
  const labels = { instant: 'Instant', medium: 'Medium', high: 'High', extra_high: 'Extra High', pro: 'Pro' };
  return labels[String(value || '').trim().toLowerCase()] || String(value || '').trim();
}
function normalizeReasoning(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}
function formatAuthenticatedAt(value) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not yet' : date.toLocaleString();
}