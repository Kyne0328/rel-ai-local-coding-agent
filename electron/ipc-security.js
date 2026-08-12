const MAX_CLIPBOARD_TEXT_BYTES = 64 * 1024;
function createWindowGuards(BrowserWindow){const isSenderWindow=(event,getWindow)=>BrowserWindow.fromWebContents(event?.sender)===getWindow();const windowOnly=(event,getWindow,label,action)=>{if(!isSenderWindow(event,getWindow))throw new Error(`${label} is not available to this renderer.`);return action();};const allowedWindows=(event,getters,label,action)=>{if(!getters.some(getWindow=>isSenderWindow(event,getWindow)))throw new Error(`${label} is not available to this renderer.`);return action();};return{isSenderWindow,windowOnly,allowedWindows};}
function logIpcFailure(error){if(process.env.REL_AI_MCP_DEBUG)console.error('[rel-ai-mcp] secured IPC action:',error);}
export { MAX_CLIPBOARD_TEXT_BYTES, createWindowGuards, logIpcFailure };
