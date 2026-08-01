# ngrok seed binaries

Rel.AI MCP ships ngrok inside the Windows installer so users do not need a separate download. The binary itself remains outside Git, while `manifest.json` records the exact reviewed release component.

```text
vendor/ngrok/manifest.json
vendor/ngrok/win32/ngrok.exe
vendor/ngrok/darwin/ngrok
vendor/ngrok/linux/ngrok
```

Fetch and verify the declared binaries with:

```sh
pwsh scripts/fetch-ngrok.ps1
```

The fetch fails closed unless the downloaded file matches the manifest's exact size and SHA-256. Windows builds additionally require a valid Authenticode signature from `ngrok, Inc.`, the expected certificate issuer, and the declared ngrok version.

When ngrok publishes a new stable agent, review it first, update `manifest.json`, and then rebuild Rel.AI. Do not accept a new upstream binary by weakening or bypassing provenance checks.

At runtime Rel.AI copies the packaged binary into the user's writable state directory. The managed copy is synchronized back to the packaged hash on launch. ngrok self-update checks and remote management are disabled; agent upgrades arrive only through signed Rel.AI application releases.
