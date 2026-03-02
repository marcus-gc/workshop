---
title: Workshop Setup
description: Prerequisites, installation, and running Workshop for the first time.
tags: [setup, installation, getting-started, docker]
---

## Prerequisites

- **Docker** with Docker Compose v2 (`docker compose` command)
- **Anthropic API key** from [console.anthropic.com](https://console.anthropic.com)

That's it. Workshop runs entirely in Docker — no local Node.js, database, or other dependencies needed.

## Quick Start

### 1. Set your API key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Build and start

```bash
docker compose up --build
```

This builds the Workshop image (multi-stage: React client + DinD server) and starts the container in privileged mode.

### 3. Open the UI

Navigate to **http://localhost:7424** in your browser.

## What Happens on Startup

```mermaid
flowchart TD
  A[docker compose up] --> B[Build Workshop image]
  B --> C[Start container - privileged]
  C --> D[entrypoint.sh]
  D --> E[Start dockerd]
  E --> F{Docker daemon ready?}
  F -->|No| F
  F -->|Yes| G[Start Workshop server]
  G --> H[Migrate SQLite schema]
  H --> I[Build Craftsman image]
  I --> J[Reconcile container states]
  J --> K[Listen on :7424]

  click D href "#" "server/entrypoint.sh"
  click G href "#" "server/src/index.ts:10-31"
  click H href "#" "server/src/db/schema.ts:3-31"
  click I href "#" "server/src/services/docker.ts:36-69"
  click J href "#" "server/src/services/docker.ts:294-315"
```

The first build of the Craftsman image takes a minute or two (installs Claude Code CLI). Subsequent starts reuse the cached image unless `Dockerfile.craftsman` changes.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | _(required)_ | Passed into every Craftsman container |
| `WORKSHOP_PORT` | `7424` | Port the server listens on |
| `WORKSHOP_DB_PATH` | `./workshop.db` | SQLite database file location |

These are configured in `docker-compose.yml`:

```mermaid
flowchart LR
  ENV[Environment Variables] --> WC[Workshop Container]
  WC -->|ANTHROPIC_API_KEY| CC[Craftsman Containers]

  click WC href "#" "docker-compose.yml:10-13"
  click CC href "#" "server/src/services/docker.ts:88-91"
```

## Exposed Ports

| Port(s) | Purpose |
|---------|---------|
| `7424` | Workshop API + web UI |
| `49200-49300` | Allocated to Craftsman container ports |

## Persistent Volumes

| Volume | Mount point | Contents |
|--------|------------|----------|
| `docker-data` | `/var/lib/docker` | Inner Docker daemon state — images, containers |
| `workshop-data` | `/data` | SQLite database |

Data persists across `docker compose down` / `up` cycles. To fully reset, remove the volumes:

```bash
docker compose down -v
```

## Development Setup

For working on Workshop itself, run the server and client separately:

```bash
# Terminal 1: Server (requires Docker daemon access)
cd server
npm install
npm run dev    # tsx watch mode, auto-reloads

# Terminal 2: React client (Vite dev server with HMR)
cd client
npm install
npm run dev    # http://localhost:5173, proxies /api to :7424
```

The client dev server proxies API requests to `localhost:7424`, so both can run simultaneously.

## Verifying the Installation

Once Workshop is running, check the health endpoint:

```bash
curl http://localhost:7424/api/health
# → {"status":"ok"}
```

Then open **http://localhost:7424** in your browser. You should see the Workshop UI with an empty Craftsmen sidebar. Next step: [create a Project](../workflows/creating_a_craftsman) and hire your first Craftsman.
