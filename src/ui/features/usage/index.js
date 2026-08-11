import { closeModal, openModal } from '../../components/modal.js';
import { getRouteParams, getWorkspaceFilter, replaceRouteParams } from '../../router.js';
import { ANALYTICS_RANGES, analyticsBounds, analyticsMonths, analyticsRangeScope, normalizeUsageSnapshot, workspaceOptions } from './range-model.js';
import { renderUsage } from './render.js';

let mountedGeneration = 0;

export async function mountUsage(container) {
  const generation = ++mountedGeneration;
  const params = getRouteParams();
  const range = ANALYTICS_RANGES.some(([key]) => key === params.get('range')) ? params.get('range') : '24h';
  const defaults = customDateDefaults();
  container.innerHTML = `
    <section class="usage-page" data-usage-page>
      <div class="feature-toolbar usage-toolbar">
        <div><h2>Analytics</h2><p>Exact Rel.AI-observed MCP activity. Trend data uses privacy-safe UTC aggregates without repository contents, prompts, paths, or tool result bodies.</p></div>
        <div class="usage-toolbar-controls">
          <label class="usage-workspace-control"><span>Workspace</span><select data-usage-workspace><option value="">All workspaces</option></select></label>
          <label class="usage-range-control"><span>Range</span><select data-usage-range>${ANALYTICS_RANGES.map(([key,label])=>`<option value="${key}"${key===range?' selected':''}>${escapeHtml(label)}</option>`).join('')}</select></label>
          <div class="usage-custom-range" data-usage-custom-range ${range==='custom'?'':'hidden'}>
            <label><span>From</span><input type="date" data-usage-start value="${escapeHtml(params.get('start')||defaults.start)}" /></label>
            <label><span>To</span><input type="date" data-usage-end value="${escapeHtml(params.get('end')||defaults.end)}" /></label>
          </div>
          <button type="button" class="secondary" data-usage-refresh>Refresh</button>
        </div>
      </div>
      <div class="usage-content" data-usage-content aria-live="polite"></div>
    </section>`;
  const root=container.querySelector('[data-usage-page]');
  const controls={root,generation,workspaceSelect:root.querySelector('[data-usage-workspace]'),rangeSelect:root.querySelector('[data-usage-range]'),customRange:root.querySelector('[data-usage-custom-range]'),startInput:root.querySelector('[data-usage-start]'),endInput:root.querySelector('[data-usage-end]'),refreshButton:root.querySelector('[data-usage-refresh]'),content:root.querySelector('[data-usage-content]')};
  const refresh=()=>loadUsage(controls);
  controls.workspaceSelect.addEventListener('change',()=>{const selection=decodeWorkspaceSelection(controls.workspaceSelect.value);replaceRouteParams({workspace:selection.workspace||null,device:selection.deviceId||null});refresh();});
  controls.rangeSelect.addEventListener('change',()=>{const custom=controls.rangeSelect.value==='custom';controls.customRange.hidden=!custom;replaceRouteParams({range:controls.rangeSelect.value==='24h'?null:controls.rangeSelect.value,start:custom?controls.startInput.value:null,end:custom?controls.endInput.value:null});refresh();});
  for(const input of [controls.startInput,controls.endInput]) input.addEventListener('change',()=>{if(controls.rangeSelect.value!=='custom')return;replaceRouteParams({start:controls.startInput.value,end:controls.endInput.value});refresh();});
  controls.refreshButton.addEventListener('click',refresh);
  await refresh();
}

async function loadUsage(controls) {
  const {root,generation,refreshButton,content}=controls;
  let bounds;
  try { bounds=analyticsBounds(controls.rangeSelect.value,{customStart:controls.startInput.value,customEnd:controls.endInput.value}); }
  catch(error){renderUnavailable(content,messageOf(error),()=>controls.rangeSelect.focus());return;}
  refreshButton.disabled=true;refreshButton.textContent='Loading…';content.setAttribute('aria-busy','true');content.innerHTML='<div class="usage-loading">Loading exact Rel.AI analytics…</div>';
  try {
    const desktop=window.relaiDesktop;
    if(!desktop?.getGatewayUsage||!desktop?.getLocalUsage)throw new Error('Rel.AI analytics are available in the installed desktop app.');
    const status=await desktop.getGatewayStatus?.();
    const direct=status?.connectionMode==='direct';
    if(!direct){const availability=cloudUsageAvailability(status);if(availability){if(!active(root,generation))return;renderCloudUsageBlocked(content,availability);showCloudUsageModal(availability);return;}}
    const usageReader=direct?desktop.getLocalUsage:desktop.getGatewayUsage;
    const models=await Promise.all(analyticsMonths(bounds).map(async month=>normalizeUsageSnapshot(await usageReader(month),month)));
    if(!active(root,generation))return;
    const params=getRouteParams();const workspace=getWorkspaceFilter();const deviceId=params.get('device')||'';
    syncWorkspaceControl(controls.workspaceSelect,models,workspace,deviceId);
    const current=analyticsRangeScope(models,bounds,{workspace,deviceId,monthlyFallback:true});
    const previous=analyticsRangeScope(models,{range:'comparison',start:bounds.previousStart,end:bounds.previousEnd},{workspace,deviceId});
    const allCurrent=analyticsRangeScope(models,bounds,{monthlyFallback:true});
    renderUsage(content,{bounds,current,previous,allCurrent});
  } catch(error) {
    if(!active(root,generation))return;
    const availability=cloudUsageAvailabilityFromError(error);
    if(availability){renderCloudUsageBlocked(content,availability);showCloudUsageModal(availability);return;}
    renderUnavailable(content,messageOf(error),()=>loadUsage(controls));
  } finally {
    if(active(root,generation)){refreshButton.disabled=false;refreshButton.textContent='Refresh';content.removeAttribute('aria-busy');}
  }
}

export function buildUsageModel(snapshot,requestedMonth=''){return normalizeUsageSnapshot(snapshot,requestedMonth);}
export function currentUsageMonth(now=new Date()){return `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;}

function syncWorkspaceControl(select,models,workspace,deviceId){
  if(!select)return;const options=workspaceOptions(models);const html=['<option value="">All workspaces</option>'];
  for(const option of options){html.push(`<option value="${escapeHtml(encodeWorkspaceSelection(option.workspace,''))}">${escapeHtml(option.workspace)}</option>`);if(option.devices.length>1)for(const device of option.devices)html.push(`<option value="${escapeHtml(encodeWorkspaceSelection(option.workspace,device.deviceId))}">↳ ${escapeHtml(option.workspace)} · ${escapeHtml(device.displayName||shortId(device.deviceId))}</option>`);}
  select.innerHTML=html.join('');const wanted=workspace?encodeWorkspaceSelection(workspace,deviceId):'';select.value=[...select.options].some(option=>option.value===wanted)?wanted:workspace?encodeWorkspaceSelection(workspace,''):'';
}
function encodeWorkspaceSelection(workspace,deviceId){return `${deviceId?'d':'a'}:${encodeURIComponent(deviceId||'')}:${encodeURIComponent(workspace||'')}`;}
function decodeWorkspaceSelection(value){if(!value)return{workspace:'',deviceId:''};const[k,d='',w='']=String(value).split(':');try{return{workspace:decodeURIComponent(w),deviceId:k==='d'?decodeURIComponent(d):''};}catch{return{workspace:'',deviceId:''};}}

function cloudUsageAvailability(status){if(!status||status.connectionMode==='direct')return null;const gateway=status.gateway&&typeof status.gateway==='object'?status.gateway:{};const state=String(gateway.state||'offline');if(state==='pairing_required'||gateway.principalPaired!==true)return{kind:'pairing_required',message:'Pair this desktop with Rel.AI Cloud before viewing Cloud analytics.'};return state!=='connected'?{kind:state||'offline',message:'Rel.AI Cloud must be connected before analytics can be loaded.'}:null;}
function cloudUsageAvailabilityFromError(error){const message=messageOf(error);return/gateway is not connected|rel\.ai cloud is not connected/i.test(message)?{kind:'offline',message:'Rel.AI Cloud must be connected before analytics can be loaded.'}:null;}
function renderCloudUsageBlocked(content,availability){const pairing=availability.kind==='pairing_required';content.innerHTML=`<section class="usage-loading">${pairing?'Pair Rel.AI with ChatGPT to view Cloud analytics.':'Rel.AI Cloud analytics will be available when the Cloud connection is online.'}</section>`;}
function showCloudUsageModal(availability){const pairing=availability.kind==='pairing_required';const body=document.createElement('div');body.className='detail-stack';body.innerHTML=`<p>${escapeHtml(availability.message)}</p><div class="section-head-actions"><a class="buttonlike primary" href="#connection" data-usage-open-connection>${pairing?'Open Connection':'Review Connection'}</a><button type="button" class="secondary" data-usage-modal-close>Close</button></div>`;const modal=openModal({title:pairing?'Pairing required':'Cloud connection unavailable',content:body});body.querySelector('[data-usage-modal-close]')?.addEventListener('click',modal.close);body.querySelector('[data-usage-open-connection]')?.addEventListener('click',closeModal);}
function renderUnavailable(content,message,retry){content.innerHTML=`<section class="usage-unavailable empty-state"><strong>Analytics unavailable</strong><p>${escapeHtml(message||'Rel.AI analytics could not be loaded.')}</p><button type="button" class="secondary" data-usage-retry>Retry</button></section>`;content.querySelector('[data-usage-retry]')?.addEventListener('click',retry);}
function customDateDefaults(now=new Date()){const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));const start=new Date(end.getTime()-6*24*60*60*1000);return{start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};}
function active(root,generation){return generation===mountedGeneration&&root.isConnected;}
function shortId(value){const text=String(value||'');return text.length>12?`${text.slice(0,8)}…${text.slice(-4)}`:text;}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);}
function messageOf(error){return error instanceof Error?error.message:String(error||'Analytics unavailable.');}
