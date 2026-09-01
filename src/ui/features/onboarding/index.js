import { postJson } from '../../api.js';
import { copyText } from '../../clipboard.js';
import { toast } from '../../components/toast.js';
import { routeMetadata } from '../../navigation-catalog.js';
import { esc } from '../../utils.js';
import { chatGptFirstPrompt, createChatGptSetupGuide } from '../settings/connection-guidance.js';

const DISMISSED_KEY = 'relai_desktop_setup_dismissed';
let completionPersisted = false;
let pendingPersisted = false;

function desktopSetupSteps({
  hasWorkspace = false,
  endpointReady = false,
  chatgptReady = false,
  firstRequestObserved = false
} = {}) {
  const requestUnlocked = hasWorkspace && endpointReady && chatgptReady;
  return [
    {
      id: 'connection',
      title: 'Connect this computer',
      description: 'In OpenAI Platform, copy the Secure MCP Tunnel ID and create a runtime API key. Save both values here.',
      href: routeMetadata('settings/connection').href,
      action: 'Set up connection',
      complete: endpointReady,
      locked: false
    },
    {
      id: 'chatgpt',
      title: 'Create the Rel.AI connector in ChatGPT',
      description: 'Open the ChatGPT Plugins + connector form. Use Tunnel + No authentication. Scan the Rel.AI tools.',
      action: 'Follow ChatGPT setup',
      actionType: 'guide',
      complete: endpointReady && chatgptReady,
      locked: !endpointReady
    },
    {
      id: 'workspace',
      title: 'Add a project',
      description: 'Choose a project folder and give it a short name.',
      href: routeMetadata('workspaces').href,
      action: hasWorkspace ? 'Project added' : 'Add project',
      complete: hasWorkspace,
      locked: false
    },
    {
      id: 'first-request',
      title: 'Send your first Rel.AI request',
      description: 'Open ChatGPT, select Rel.AI MCP, and send the request below to make sure ChatGPT can reach your project.',
      action: 'Copy first request',
      actionType: 'copy',
      complete: requestUnlocked && firstRequestObserved,
      locked: !requestUnlocked
    }
  ];
}

export function desktopSetupItems(options = {}) {
  return desktopSetupSteps(options).filter(item => !item.complete);
}

export function createDesktopSetupChecklist(options = {}) {
  const steps = desktopSetupSteps(options);
  const remaining = steps.filter(item => !item.complete);
  if (!remaining.length || isDesktopSetupDismissed()) return null;

  const current = steps.find(item => !item.complete && !item.locked) || remaining[0];
  const completedCount = steps.length - remaining.length;
  const checklist = document.createElement('section');
  checklist.className = 'card desktop-setup-checklist';
  checklist.dataset.desktopSetupChecklist = '';
  checklist.innerHTML = `
    <div class="card-head desktop-setup-head">
      <div>
        <span class="desktop-setup-eyebrow">Getting started</span>
        <h3>Get Rel.AI working with ChatGPT</h3>
        <p>${completedCount} of ${steps.length} steps complete. Follow the highlighted step.</p>
      </div>
      <button class="secondary compact-button" type="button" data-dismiss-setup>Dismiss guide</button>
    </div>`;

  const body = document.createElement('div');
  body.className = 'card-body desktop-setup-items';
  steps.forEach((item, index) => body.appendChild(renderSetupStep(item, index, current?.id, options)));
  checklist.appendChild(body);

  checklist.querySelector('[data-dismiss-setup]').addEventListener('click', async () => {
    setDesktopSetupDismissed(true);
    checklist.remove();
    await persistDesktopSetup({ skipped: true, handoffPending: false, source: 'overview-checklist' });
    toast('Getting started guide dismissed.', { variant: 'info' });
  });
  checklist.querySelector('[data-copy-first-request]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      await copyText(chatGptFirstPrompt(options.workspaceAlias));
      button.textContent = 'Copied';
      setTimeout(() => { if (button.isConnected) button.textContent = 'Copy first request'; }, 1400);
    } catch {
      toast('Clipboard access failed.', { variant: 'error' });
    }
  });
  return checklist;
}

function renderSetupStep(item, index, currentId, options = {}) {
  const row = document.createElement('div');
  const current = item.id === currentId;
  row.className = `desktop-setup-item${item.complete ? ' done' : ''}${current ? ' current' : ''}${item.locked ? ' locked' : ''}`;
  const state = item.complete ? 'Done' : item.locked ? 'Not ready' : current ? 'Next' : 'Ready';
  const action = renderSetupAction(item, current);
  row.innerHTML = `
    <span class="desktop-setup-index" aria-hidden="true">${item.complete ? '✓' : index + 1}</span>
    <div class="desktop-setup-copy">
      <div class="desktop-setup-title-row"><strong>${esc(item.title)}</strong><span class="desktop-setup-state">${state}</span></div>
      <p>${esc(item.description)}</p>
      ${item.id === 'first-request' && current ? `<div class="desktop-first-request"><span>Paste this into ChatGPT</span><code>${esc(chatGptFirstPrompt(options.workspaceAlias))}</code></div>` : ''}
    </div>
    ${action}`;
  if (item.id === 'chatgpt' && current) {
    const guide = createChatGptSetupGuide({
      compact: true,
      mode: 'create',
      tunnelId: options.tunnelId,
      connectorName: options.connectorName,
      includeFirstPrompt: false
    });
    guide.classList.add('desktop-chatgpt-guide');
    row.querySelector('.desktop-setup-copy')?.appendChild(guide);
  }
  return row;
}

function renderSetupAction(item, current) {
  if (item.complete || item.locked || item.actionType === 'guide') return '';
  if (item.actionType === 'copy') {
    return `<button class="${current ? 'primary' : 'secondary'} compact-button" type="button" data-copy-first-request>${esc(item.action)}</button>`;
  }
  return `<a class="buttonlike ${current ? 'primary' : 'secondary'} compact-button" href="${esc(item.href)}">${esc(item.action)}</a>`;
}

export async function completeDesktopSetup() {
  setDesktopSetupDismissed(true);
  if (completionPersisted) return null;
  completionPersisted = true;
  return persistDesktopSetup({ completed: true, handoffPending: false, source: 'overview-checklist' });
}

export function syncDesktopSetupState(status = {}) {
  const pending = status.needsOnboarding === true || status.handoffPending === true;
  setDesktopSetupDismissed(!pending);
  if (pending) persistPendingSetup();
  return pending;
}

function isDesktopSetupDismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
}

function setDesktopSetupDismissed(value) {
  try {
    if (value) localStorage.setItem(DISMISSED_KEY, '1');
    else localStorage.removeItem(DISMISSED_KEY);
  } catch {}
}

function persistPendingSetup() {
  if (pendingPersisted) return;
  pendingPersisted = true;
  void persistDesktopSetup({ completed: false, skipped: false, handoffPending: true, source: 'overview-checklist' })
    .then(result => { if (!result) pendingPersisted = false; });
}

async function persistDesktopSetup(payload) {
  try {
    return await postJson('/api/onboarding/complete', payload);
  } catch {
    return null;
  }
}
