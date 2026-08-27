import { STATIC_CONTEXT } from '../context/static-context.js';

const PUBLIC_MCP_SERVER_INSTRUCTIONS = `${STATIC_CONTEXT} Reuse the current work_id for the same objective. Use brief user-visible progress preambles before meaningful tool calls and between long tool sequences so the user can follow what is being checked or changed. Summarize intent and concrete findings; do not expose private chain-of-thought. Do not poll relai_work status merely to refresh UI; call status only when the task state or a long-running operation result is needed.`;

export { PUBLIC_MCP_SERVER_INSTRUCTIONS };
