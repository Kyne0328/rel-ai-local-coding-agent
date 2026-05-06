@echo off
setlocal
cd /d "%~dp0.."
node bin\rel-ai-mcp-launch.js %*
