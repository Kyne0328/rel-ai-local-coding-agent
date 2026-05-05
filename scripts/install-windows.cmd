@echo off
setlocal
cd /d %~dp0\..
node --check bin\rel-ai-mcp.js || exit /b 1
node --check bin\rel-ai-mcp-http.js || exit /b 1
node --check bin\relai-mcp-config.js || exit /b 1
echo Rel.AI MCP checked successfully.
echo Next: npm run init-config ^&^& npm run workspace:add -- myapp C:\path\to\project
