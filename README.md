# DSC Operations Dashboard

A browser-based GUI that replaces the ~30 shell commands in `LOCAL.MD` with a single-page dashboard for managing a local FIWARE Data Space Connector deployment.

## What it does

- Runs each DSC setup step via clickable buttons with live output
- Automatically captures session state (credentials, IDs) between steps
- Works with self-signed `*.127.0.0.1.nip.io` certificates (TLS verification intentionally disabled for local use)
- Routes requests through the in-cluster Squid proxy for Keycloak and VCVerifier

## Quick Start

```bash
npm install   # installs express, node-fetch, https-proxy-agent
node server.js
```

Open `http://localhost:5000` (or `PORT` env var to override).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | HTTP port |
| `SQUID_PROXY` | `http://localhost:8888` | Squid proxy URL — set to empty string to disable |

## Stack

Node.js · Express · vanilla JS frontend
