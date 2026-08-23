import { STATIC_CONTEXT } from '../context/static-context.js';

const PUBLIC_MCP_SERVER_INSTRUCTIONS = `${STATIC_CONTEXT} Reuse the current work_id for the same objective. Do not poll relai_work status merely to refresh UI; call status only when the task state or a long-running operation result is needed.`;

export { PUBLIC_MCP_SERVER_INSTRUCTIONS };
