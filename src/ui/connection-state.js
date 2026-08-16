const DEFAULT_STATE = Object.freeze({
  localService: { status: 'stopped' },
  publicEndpoint: { status: 'disabled' },
  chatgptReadiness: { status: 'unavailable' },
  mcpClient: { status: 'stopped' },
  dashboardUpdates: { status: 'offline' },
  error: null
});

const LAYERS = Object.freeze([
  ['localService', 'Local MCP service', { running: ['Running','ok','The local Rel.AI MCP service is running on loopback only.'], starting: ['Starting','working','Rel.AI is starting the local MCP service.'], stopped: ['Stopped','warn','The local MCP service is stopped.'], failed: ['Failed','bad','The local MCP service failed to start.'] }],
  ['publicEndpoint', 'OpenAI Secure MCP Tunnel', { available: ['Connected','ok','The Secure MCP Tunnel is ready to forward MCP requests to this computer.'], connecting: ['Connecting','working','Rel.AI is establishing the Secure MCP Tunnel.'], unavailable: ['Unavailable','bad','The Secure MCP Tunnel could not become ready.'], disabled: ['Not configured','warn','A Secure MCP Tunnel ID and runtime API key are required.'] }],
  ['chatgptReadiness', 'Ready for ChatGPT', { ready: ['Ready','ok','Rel.AI is ready for ChatGPT requests through the configured tunnel.'], unavailable: ['Unavailable','warn','Rel.AI becomes ready for ChatGPT after the local service and Secure MCP Tunnel are connected.'] }],
  ['mcpClient', 'MCP activity', { stopped: ['Stopped','warn','The MCP transport is not accepting requests.'], starting: ['Starting','working','The MCP transport is starting.'], active: ['Active now','working','One or more MCP requests are running.'], recent: ['Recently active','ok','A recent MCP request completed through this local service.'], connected: ['Recently active','ok','A recent MCP request completed through this local service.'], idle: ['Ready','ok','The MCP transport is ready for requests.'], no_requests: ['Ready','ok','The tunnel is ready; no MCP request has been observed since startup.'], request_failed: ['Last request failed','warn','The most recent MCP request failed.'], failed: ['Failed','bad','The MCP transport failed.'], ready: ['Ready','ok','The MCP transport is ready for requests.'] }],
  ['dashboardUpdates', 'Dashboard updates', { live: ['Live','ok','This dashboard is receiving live local state updates.'], connecting: ['Connecting','working','The dashboard is opening its live update stream.'], reconnecting: ['Reconnecting','working','The dashboard is restoring its live update stream.'], paused: ['Paused','warn','Live dashboard updates are paused.'], offline: ['Offline','bad','This dashboard is not receiving live updates.'] }]
]);

const ALLOWED = Object.freeze({
  localService: new Set(['running','starting','stopped','failed']),
  publicEndpoint: new Set(['available','connecting','unavailable','disabled']),
  chatgptReadiness: new Set(['ready','unavailable']),
  mcpClient: new Set(['stopped','starting','active','recent','connected','idle','no_requests','request_failed','failed','ready']),
  dashboardUpdates: new Set(['live','connecting','reconnecting','paused','offline'])
});

function normalizeConnectionState(state = {}) {
  return {
    localService: normalizeLayer('localService', state.localService, DEFAULT_STATE.localService.status),
    publicEndpoint: normalizeLayer('publicEndpoint', state.publicEndpoint, DEFAULT_STATE.publicEndpoint.status),
    chatgptReadiness: normalizeLayer('chatgptReadiness', state.chatgptReadiness, DEFAULT_STATE.chatgptReadiness.status),
    mcpClient: normalizeLayer('mcpClient', state.mcpClient, DEFAULT_STATE.mcpClient.status),
    dashboardUpdates: normalizeLayer('dashboardUpdates', state.dashboardUpdates, DEFAULT_STATE.dashboardUpdates.status),
    error: normalizeError(state.error)
  };
}
export function connectionStateFor(data = {}, dashboardStatus = '') {
  const source = data.connectionState || data.desktopStatus?.connectionState || DEFAULT_STATE;
  const mcpConnection = data.mcpConnection && typeof data.mcpConnection === 'object' ? { ...data.mcpConnection, status: normalizeActivity(data.mcpConnection.activityStatus || data.mcpConnection.status) } : source.mcpClient;
  const normalized = normalizeConnectionState({ ...source, mcpClient: mcpConnection });
  normalized.mode = 'secure_tunnel';
  normalized.chatgptReadiness = { status: normalized.localService.status === 'running' && normalized.publicEndpoint.status === 'available' ? 'ready' : 'unavailable' };
  if (dashboardStatus) normalized.dashboardUpdates = { status: ALLOWED.dashboardUpdates.has(dashboardStatus) ? dashboardStatus : 'offline' };
  return normalized;
}
export function withConnectionState(data = {}, dashboardStatus = '') { return { ...data, connectionState: connectionStateFor(data, dashboardStatus) }; }
export function isMcpAuthenticationReady(state = {}) { return String(state.chatgptReadiness?.status || state.status || '') === 'ready'; }
export function connectionLayerViews(state = {}) {
  const normalized = normalizeConnectionState(state);
  return LAYERS.map(([key,title,descriptions]) => { const value=normalized[key]; const [label,tone,description]=descriptions[value.status]||['Unknown','warn','Connection state is unavailable.']; return { key,title,status:value.status,label,tone,description:key==='mcpClient'?requestDescription(value,description):description }; });
}
export function connectionSummary(state = {}) {
  const normalized=normalizeConnectionState(state), local=normalized.localService.status, tunnel=normalized.publicEndpoint.status, activity=normalized.mcpClient.status, error=normalized.error?.message||'';
  if(local==='failed')return summary('Local MCP service failed','Needs attention','bad',error||'Rel.AI could not start its local MCP service.');
  if(local==='stopped')return summary('Rel.AI is stopped','Stopped','warn','Start or restart Rel.AI before ChatGPT can use this computer.');
  if(local==='starting')return summary('Starting Rel.AI','Starting','working','Rel.AI is preparing the local MCP service.');
  if(tunnel==='unavailable')return summary('Secure MCP Tunnel unavailable','Needs attention','bad',error||'Review the OpenAI Tunnel ID and runtime API key.');
  if(tunnel==='disabled')return summary('Secure MCP Tunnel setup required','Setup required','warn','Configure the OpenAI Secure MCP Tunnel for this computer.');
  if(tunnel==='connecting')return summary('Connecting Secure MCP Tunnel','Connecting','working','The local service is ready while Rel.AI establishes the Secure MCP Tunnel.');
  if(activity==='request_failed')return summary('The last MCP request failed','Last request failed','warn',requestDescription(normalized.mcpClient,'Review Activity or Diagnostics for the request error.'));
  if(activity==='active')return summary('MCP request in progress','Active now','working',requestDescription(normalized.mcpClient,'An MCP request is running.'));
  if(activity==='recent'||activity==='connected')return summary('Rel.AI is available to ChatGPT','Recently active','ok',requestDescription(normalized.mcpClient,'A recent MCP request completed successfully.'));
  return summary('Rel.AI is ready for ChatGPT','Ready','ok','The local MCP service and OpenAI Secure MCP Tunnel are connected.');
}
function normalizeLayer(key,value,fallback){const source=value&&typeof value==='object'?value:{};const status=String(source.status||fallback);return{...source,status:ALLOWED[key].has(status)?status:fallback};}
function normalizeActivity(value){const status=String(value||'no_requests');if(ALLOWED.mcpClient.has(status))return status;if(status==='request_succeeded')return'recent';return'no_requests';}
function normalizeError(error){if(!error||typeof error!=='object')return null;const message=String(error.message||'').trim();return message?{code:String(error.code||'unknown'),message}:null;}
function summary(title,label,tone,message){return{title,label,tone,message};}
function requestDescription(value={},fallback){const at=value.lastRequestAt||value.lastSuccessfulRequestAt||value.lastFailedRequestAt,method=String(value.lastMethod||''),name=String(value.lastToolName||'');if(!at&&!method&&!name)return fallback;const parts=[];if(name)parts.push(`Latest tool: ${name}.`);else if(method)parts.push(`Latest request: ${method}.`);if(at)parts.push(`Observed ${new Date(at).toLocaleString()}.`);return parts.join(' ')||fallback;}
