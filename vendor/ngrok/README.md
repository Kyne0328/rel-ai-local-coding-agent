# ngrok acquisition manifest

Rel.AI MCP does not store or package `ngrok.exe`. `manifest.json` records the exact reviewed Windows x64 component that the desktop app may download after explicit first-run consent.

```text
vendor/ngrok/manifest.json
```

The manifest pins:

- the exact ngrok version;
- an immutable official HTTPS archive URL;
- archive size and SHA-256;
- executable filename, size, and SHA-256; and
- Windows Authenticode publisher and certificate issuer.

Validate the manifest without downloading:

```sh
npm run verify:ngrok
```

Exercise the complete Windows acquisition in a temporary directory:

```sh
npm run verify:ngrok -- --download
```

The end-to-end check downloads the official archive, verifies it, extracts exactly one expected executable, validates executable integrity, Authenticode identity, and version, then removes the temporary files. It never writes a seed into this repository.

At runtime Rel.AI performs the same verification before atomically installing the managed agent under the user state directory. Existing bytes are reused only while they remain valid. ngrok self-update checks and remote management are disabled.
