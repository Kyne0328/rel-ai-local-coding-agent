# ngrok seed binaries

Place the ngrok agent binaries here before building the Electron app:

```txt
vendor/ngrok/win32/ngrok.exe
vendor/ngrok/darwin/ngrok
vendor/ngrok/linux/ngrok
```

These binaries are **not committed to git** (they are gitignored). Fetch them with:

```sh
pwsh scripts/fetch-ngrok.ps1   # Windows
scripts/fetch-ngrok.sh         # macOS / Linux / CI
```

Both download the official ngrok v3 stable agent (amd64 by default; set `NGROK_ARCH=arm64`
for Apple Silicon / arm64 Linux). Do not commit unofficial or unverified binaries.

Rel.AI MCP copies the bundled seed binary to the user's writable Rel.AI state folder on first launch, then runs the managed copy from there. The managed copy can update itself without requiring users to install npm, Node, or ngrok manually.
