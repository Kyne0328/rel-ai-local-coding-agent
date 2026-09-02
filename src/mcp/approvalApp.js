const APPROVAL_UI_URI = 'ui://relai/approval/v1.html';
const APPROVAL_RENDER_TOOL = 'relai_approval';
const APPROVAL_DECISION_TOOL = 'relai_app_approval_decide';

const approvalViewProperties = Object.freeze({
  ok: { type: 'boolean' },
  approvalId: { type: 'string' },
  message: { type: 'string' },
  tool: { type: 'string' },
  operation: { type: 'string' },
  workspace: { type: 'string' },
  work_id: { type: 'string' },
  remote: { type: 'string' },
  branch: { type: 'string' },
  head: { type: 'string' },
  setUpstream: { type: 'boolean' },
  expiresAt: { type: 'string' },
  error: { type: 'string' },
  errorCode: { type: 'string' },
  cancelled: { type: 'boolean' }
});

const APPROVAL_RENDER_SCHEMA = Object.freeze({
  name: APPROVAL_RENDER_TOOL,
  title: 'Show Rel.AI approval',
  description: 'Show a pending Rel.AI approval request in ChatGPT. Use only when another Rel.AI tool returns approvalRequired with an approvalId.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: { approvalId: { type: 'string', minLength: 1, description: 'Pending approval ID returned by Rel.AI.' } },
    required: ['approvalId'],
    additionalProperties: false
  }),
  outputSchema: Object.freeze({
    type: 'object',
    properties: approvalViewProperties,
    required: ['ok'],
    additionalProperties: true
  }),
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }),
  _meta: Object.freeze({
    securitySchemes: Object.freeze([Object.freeze({ type: 'noauth' })]),
    ui: Object.freeze({ resourceUri: APPROVAL_UI_URI }),
    'openai/outputTemplate': APPROVAL_UI_URI,
    'openai/toolInvocation/invoking': 'Preparing approval…',
    'openai/toolInvocation/invoked': 'Approval ready'
  })
});

const APPROVAL_DECISION_SCHEMA = Object.freeze({
  name: APPROVAL_DECISION_TOOL,
  title: 'Confirm Rel.AI approval',
  description: 'Apply the user decision from the Rel.AI approval control.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: {
      approvalId: { type: 'string', minLength: 1 },
      approved: { type: 'boolean' }
    },
    required: ['approvalId', 'approved'],
    additionalProperties: false
  }),
  outputSchema: Object.freeze({
    type: 'object',
    properties: approvalViewProperties,
    required: ['ok'],
    additionalProperties: true
  }),
  annotations: Object.freeze({
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  }),
  _meta: Object.freeze({
    securitySchemes: Object.freeze([Object.freeze({ type: 'noauth' })]),
    ui: Object.freeze({ visibility: Object.freeze(['app']) })
  })
});

function approvalMcpToolSchemas() {
  return [APPROVAL_RENDER_SCHEMA, APPROVAL_DECISION_SCHEMA];
}

function approvalAppHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rel.AI approval</title>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark}
*{box-sizing:border-box}body{margin:0;padding:12px;background:transparent;color:CanvasText}
.card{border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:12px;padding:14px;background:Canvas}
.kicker{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.65}h2{font-size:16px;margin:4px 0 12px}
.grid{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px}.grid span{opacity:.65}.grid code{overflow-wrap:anywhere}
.actions{display:flex;gap:8px;margin-top:14px}button{font:inherit;border-radius:8px;padding:8px 12px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);cursor:pointer}
.primary{background:CanvasText;color:Canvas}.secondary{background:transparent;color:CanvasText}button:disabled{opacity:.5;cursor:default}
.status{font-size:13px;margin-top:10px;min-height:18px}.error{color:#b42318}@media(prefers-color-scheme:dark){.error{color:#ffb4ab}}
</style>
</head>
<body>
<main class="card" aria-live="polite">
  <div class="kicker">Rel.AI approval</div>
  <h2 id="title">Loading approval…</h2>
  <div class="grid" id="details"></div>
  <div class="actions" id="actions" hidden>
    <button class="primary" id="approve" type="button">Approve</button>
    <button class="secondary" id="cancel" type="button">Cancel</button>
  </div>
  <div class="status" id="status"></div>
</main>
<script>
(() => {
  const pending = new Map(); let seq = 1; let approval = null;
  const title = document.getElementById('title'); const details = document.getElementById('details');
  const actions = document.getElementById('actions'); const status = document.getElementById('status');
  const approve = document.getElementById('approve'); const cancel = document.getElementById('cancel');
  function text(value){ return value == null ? '' : String(value); }
  function row(label,value,code=false){ if(!value)return; const a=document.createElement('span');a.textContent=label;const b=document.createElement(code?'code':'strong');b.textContent=text(value);details.append(a,b); }
  function render(value){ approval=value&&typeof value==='object'?value:null; details.replaceChildren(); status.textContent=''; status.className='status';
    if(!approval||approval.ok===false){ title.textContent=approval?.error||'Approval is no longer available.'; actions.hidden=true; return; }
    title.textContent=approval.message||'Confirm this Rel.AI operation'; row('Project',approval.workspace); row('Remote',approval.remote); row('Branch',approval.branch); row('Commit',approval.head,true); row('Operation',approval.operation); approve.textContent=approval.operation==='push'&&approval.remote?'Push to '+approval.remote:'Approve'; actions.hidden=false; }
  function call(name,args){ const id=seq++; parent.postMessage({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}},'*'); return new Promise((resolve,reject)=>pending.set(id,{resolve,reject})); }
  window.addEventListener('message',event=>{ const message=event.data||{}; if(message.method==='ui/notifications/tool-result'){ render(message.params?.structuredContent||message.params?.result?.structuredContent||message.params); return; }
    if(!Object.hasOwn(message,'id')||!pending.has(message.id))return; const request=pending.get(message.id);pending.delete(message.id); if(message.error)request.reject(new Error(message.error.message||'Approval failed.')); else request.resolve(message.result); });
  async function decide(approved){ if(!approval?.approvalId)return; approve.disabled=true;cancel.disabled=true;status.textContent=approved?'Publishing…':'Cancelling…'; try{ const result=await call('${APPROVAL_DECISION_TOOL}',{approvalId:approval.approvalId,approved}); const value=result?.structuredContent||result; if(value?.ok===false){status.textContent=value.error||'Approval failed.';status.className='status error';approve.disabled=false;cancel.disabled=false;return;} status.textContent=approved?'Published.':'Cancelled.';actions.hidden=true; }catch(error){status.textContent=error?.message||String(error);status.className='status error';approve.disabled=false;cancel.disabled=false;} }
  approve.addEventListener('click',()=>void decide(true)); cancel.addEventListener('click',()=>void decide(false));
})();
</script>
</body>
</html>`;
}

export {
  APPROVAL_DECISION_SCHEMA,
  APPROVAL_DECISION_TOOL,
  APPROVAL_RENDER_SCHEMA,
  APPROVAL_RENDER_TOOL,
  APPROVAL_UI_URI,
  approvalAppHtml,
  approvalMcpToolSchemas
};
