---
title: Architecture
description: Docker-in-Docker design, networking, port forwarding, and system components.
tags: [architecture, docker, dind, networking, concepts]
---

## Overview

Workshop runs as a single Docker container that hosts its own Docker daemon inside it (Docker-in-Docker). This inner daemon spawns and manages Craftsman containers. The Workshop server, React UI, SQLite database, and inner Docker daemon all live in one outer container.

```mermaid
flowchart TD
  subgraph Host["Host Machine"]
    subgraph WC["Workshop Container (docker:27-dind, privileged)"]
      EP[entrypoint.sh] --> DD[dockerd]
      EP --> WS[Workshop Server - Hono]
      WS --> DB[(SQLite)]
      WS --> UI[React UI - static]
      WS --> MB[MCP Bridges]
      DD --> C1["Craftsman: alice"]
      DD --> C2["Craftsman: bob"]
    end
  end

  Browser -->|:7424| WS
  Browser -->|:49200-49300| DD

  click EP href "#" "server/entrypoint.sh"
  click WS href "#" "server/src/index.ts"
  click DB href "#" "server/src/db/schema.ts:3-37"
  click DD href "#" "docker-compose.yml:6-6"
  click MB href "#" "server/src/services/mcp-bridge.ts:186-195"
  click C1 href "#" "server/Dockerfile.craftsman"
  click WC href "#" "server/Dockerfile:12-41"
```

## Docker-in-Docker (DinD)

The Workshop container uses `docker:27-dind` as its base image and runs in **privileged mode**. On startup, `entrypoint.sh` starts `dockerd` in the background, waits for it to become ready, then launches the Workshop server.

```mermaid
sequenceDiagram
  participant E as entrypoint.sh
  participant D as dockerd
  participant S as Workshop Server

  E->>D: Start daemon (background)
  loop Wait for ready
    E->>D: docker info
    D-->>E: Not ready / Ready
  end
  E->>S: exec tsx src/index.ts

  click E href "#" "server/entrypoint.sh"
  click S href "#" "server/src/index.ts:11-28"
```

Two Docker volumes persist state across restarts:

| Volume | Mount | Purpose |
|--------|-------|---------|
| `docker-data` | `/var/lib/docker` | Inner Docker daemon state (images, containers) |
| `workshop-data` | `/data` | SQLite database |

## Server Initialization

When the Workshop server starts, it runs through this sequence:

```mermaid
flowchart TD
  A[Migrate DB] --> B[Build/verify Craftsman image]
  B --> C[Start MCP bridges]
  C --> D[Reconcile container states]
  D --> E[Setup WebSocket handler]
  E --> F[Listen on port 7424]

  click A href "#" "server/src/db/schema.ts:3-37"
  click B href "#" "server/src/services/docker.ts:50-83"
  click C href "#" "server/src/services/mcp-bridge.ts:186-195"
  click D href "#" "server/src/services/docker.ts:501-522"
  click E href "#" "server/src/services/websocket.ts:58-86"
  click F href "#" "server/src/index.ts:25-27"
```

**Reconciliation** ensures that if a Craftsman container died while the server was down, its database status is updated to `stopped`.

## Craftsman Containers

Each Craftsman runs in its own container built from `Dockerfile.craftsman`:

```mermaid
flowchart TD
  subgraph Image["workshop-craftsman image"]
    N[Node.js 22] --> G[git]
    G --> TM[tmux]
    TM --> DK[Docker daemon]
    DK --> CC[Claude Code CLI]
    CC --> U[User: craftsman]
  end

  click Image href "#" "server/Dockerfile.craftsman"
```

The image is built once on server startup and cached using a SHA256 hash of the Dockerfile. If the Dockerfile changes, the image is rebuilt automatically.

Key characteristics:
- **Non-root**: Runs as the `craftsman` user with passwordless sudo
- **Pre-configured**: Claude Code onboarding is skipped via `~/.claude.json`
- **Docker-in-Docker**: Each container runs its own `dockerd` for Claude Code tool use
- **Long-lived**: A craftsman entrypoint script starts dockerd, then `tail -f /dev/null` keeps the container alive
- **API key injected**: `ANTHROPIC_API_KEY` is passed as an environment variable at container creation

## Networking & Port Forwarding

Craftsman containers can expose ports (e.g. 3000 for a dev server). Workshop allocates host ports from the range **49200–49300** and maps them to container ports.

```mermaid
flowchart LR
  B[Browser] -->|:49200| P1["alice:3000"]
  B -->|:49201| P2["bob:3000"]

  click P1 href "#" "server/src/services/docker.ts:85-140"
```

Each port is accessed directly via the allocated host port:

```
http://localhost:{hostPort}
```

The **Preview** tab in the UI uses these direct host port URLs to embed iframes of running services.

### Port Allocation

When a Craftsman is created, the server allocates one host port per container port by scanning the 49200–49300 range for unused ports. The mapping is stored in the database as JSON. Ports that recently caused conflicts are temporarily excluded.

```mermaid
flowchart TD
  A[Project ports: 3000, 8080] --> B[allocatePort for each]
  B --> C["port_mappings: {3000: 49200, 8080: 49201}"]
  C --> D[Docker PortBindings configured]
  D --> E[Stored in craftsmen table]

  click B href "#" "server/src/services/docker.ts:85-140"
  click D href "#" "server/src/services/docker.ts:100-115"
  click E href "#" "server/src/db/schema.ts:16-27"
```

### MCP Bridge Ports

MCP bridges use a separate port range: **48100–48399**. These ports allow Craftsman containers to reach host MCP servers via SSE. See [MCP Bridges](mcp_bridges) for details.

## Terminal Access

Each Craftsman gets a tmux session (`main`) in `/workspace/project`. The web UI connects via WebSocket for an interactive terminal:

```mermaid
sequenceDiagram
  participant B as Browser (xterm.js)
  participant W as WebSocket Server
  participant D as Docker exec
  participant T as tmux (in container)

  B->>W: Upgrade /api/craftsmen/:id/terminal
  W->>D: exec tmux new-session -A -s main
  D->>T: Attach to session
  loop Interactive I/O
    B->>W: Keystrokes (binary)
    W->>D: Write to stream
    D->>T: Input
    T-->>D: Output
    D-->>W: Read from stream
    W-->>B: Terminal output (binary)
  end
  B->>W: {"type":"resize","cols":120,"rows":40}
  W->>D: exec.resize()

  click W href "#" "server/src/services/websocket.ts:8-56"
  click D href "#" "server/src/services/terminal.ts:4-24"
```

The `-A` flag on `tmux new-session` reattaches to an existing session if one exists, so multiple terminal connections share the same tmux session.

## Real-Time Events

Workshop uses **Server-Sent Events (SSE)** instead of polling for status changes and container logs:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/craftsmen/:id/events` | Status transitions (`starting` → `running`, etc.) |
| `GET /api/craftsmen/:id/logs` | Container stdout/stderr stream |

An in-process `EventEmitter` broadcasts status changes to all connected SSE clients.

## Git Workflow

Git operations run inside the Craftsman container via `docker exec`:

```mermaid
flowchart LR
  A[GET /diff] --> B[POST /git/commit]
  B --> C[POST /git/push]
  C --> D[POST /git/pr]

  click A href "#" "server/src/services/docker.ts:413-420"
  click B href "#" "server/src/services/docker.ts:422-439"
  click C href "#" "server/src/services/docker.ts:441-451"
  click D href "#" "server/src/routes/git.ts:71-127"
```

Pushes go to a `craftsman/{name}` branch. PRs are opened via the GitHub API using the project's stored token.
