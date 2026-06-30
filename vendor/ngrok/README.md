# ngrok seed binaries

```txt
vendor/ngrok/win32/ngrok.exe
vendor/ngrok/darwin/ngrok
vendor/ngrok/linux/ngrok
```

Rel.AI MCP copies the bundled seed binary to the user's writable Rel.AI state folder on first launch, then runs the managed copy from there. The managed copy can update itself without requiring users to install npm, Node, or ngrok manually.