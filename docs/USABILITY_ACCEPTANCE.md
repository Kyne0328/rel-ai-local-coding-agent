# Usability acceptance and release evidence

Rel.AI MCP separates repeatable installed-app validation from checks that require real external accounts and published infrastructure. A release is not described as fully accepted merely because local automation passed.

## Automated exact-installer acceptance

The Windows release workflow builds the candidate executables, selects the exact NSIS installer intended for publication, installs it into an isolated profile, and launches that installed executable through two smoke modes. The automation verifies:

1. packaged resources, including the bundled ngrok seed;
2. local service health and dashboard HTTP loading;
3. the packaged public MCP tool count;
4. first-run setup and failure-recovery renderers;
5. the interactive dashboard overview;
6. refresh behavior without losing scroll position or control state;
7. workspace scope in the route;
8. legacy Settings route normalization; and
9. the Sessions-to-Activity detail journey.

Rendered evidence is captured for setup, recovery, the dashboard overview, and the exact Activity detail destination. Each image and the installer are recorded with SHA-256 hashes.

The primary output is `release-readiness.json`. Its successful automated state is deliberately named:

```text
automated_passed_manual_required
```

The release also publishes `release-usability-evidence.zip`, containing the JSON record and rendered screenshots. Both files are included in `SHA256SUMS.txt`.

## Manual external acceptance

Automated acceptance does not replace the external checks below:

- **Real ngrok publication:** clean first run must publish the configured permanent domain from a real ngrok account and remain externally reachable.
- **ChatGPT OAuth:** a real ChatGPT app must discover the OAuth endpoints, complete approval, and successfully call `relai_status`.
- **Live approval-token rotation:** the existing ChatGPT app must lose its current grants, request approval again, and reconnect with the replacement token without changing the MCP URL.
- **Update from a previous published release:** the previous installed release must discover, download, verify, and install the candidate through the production GitHub Releases feed.

These checks remain `not_recorded` in automated evidence. The evidence validator rejects any automated record that claims they passed.

## Run locally

Build, install, and validate a new candidate while keeping the evidence:

```powershell
$env:REL_AI_RELEASE_EVIDENCE_DIR = "$PWD\dist\release-evidence"
npm run test:installed
npm run release:evidence:check -- ".\dist\release-evidence\release-readiness.json"
```

Validate a specific prebuilt installer instead of building another one:

```powershell
$env:REL_AI_SMOKE_INSTALLER = "C:\path\to\Rel.AI MCP Setup 0.20.7.exe"
$env:REL_AI_RELEASE_EVIDENCE_DIR = "$PWD\dist\release-evidence"
npm run test:installed
npm run release:evidence:check -- ".\dist\release-evidence\release-readiness.json" --installer $env:REL_AI_SMOKE_INSTALLER
```

The smoke harness installs and removes the application under an isolated Windows profile. The retained evidence directory is not deleted with that sandbox.

## Interpretation

A valid automated record proves that the tested installer bytes produced the recorded local installed-app journeys and screenshots. It does not prove external ngrok reachability, successful interaction with the current ChatGPT service, revocation of live OAuth grants, or an upgrade from a previous published version. Those four checks must be recorded separately before release approval.
