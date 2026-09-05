import { STATIC_CONTEXT } from '../context/static-context.js';

const PUBLIC_MCP_SERVER_INSTRUCTIONS = `${STATIC_CONTEXT} For an active durable session, pass work_id only where attribution is wanted; omission never selects another task. Keep the user informed with brief normal assistant progress messages before meaningful tool calls and between long tool sequences. Native tool invocation labels are supplemental status only. Summarize intent and findings; do not expose private chain-of-thought. Do not poll relai_work status merely to refresh UI; use status only for task state or long-running results.`;

export { PUBLIC_MCP_SERVER_INSTRUCTIONS };
