---
title: Port Forwarding
description: How Craftsman port forwarding works and how to access exposed services.
tags: [ports, networking, proxy, workflow]
---

## How Port Forwarding Works

When a [Project](../key_concepts/project) defines `ports` (e.g. `[3000]`), each Craftsman assigned to that project gets those container ports mapped to unique host ports in the range **49200–49300**.

```mermaid
flowchart LR
  subgraph Project
    PP["ports: [3000, 8080]"]
  end
  subgraph Craftsman["Craftsman: alice"]
    C3["3000 → 49200"]
    C8["8080 → 49201"]
  end
  Project --> Craftsman

  click PP href "#" "server/src/db/schema.ts:5-14"
  click C3 href "#" "server/src/services/docker.ts:71-101"
```

The mapping is determined at container creation time and stored in the Craftsman's `port_mappings` field as JSON:

```json
{"3000": 49200, "8080": 49201}
```

## Accessing Exposed Services

There are two ways to reach a service running inside a Craftsman container:

### 1. Direct host port

```
http://localhost:{hostPort}
```

For example, if `port_mappings` shows `{"3000": 49200}`:

```
http://localhost:49200
```

This works from your browser, curl, or any tool on the host machine.

### 2. Reverse proxy

```
http://localhost:7424/proxy/{craftsmanName}/{containerPort}/
```

For example:

```
http://localhost:7424/proxy/alice/3000/
```

The Workshop server proxies the request to the correct host port. This is what the **Preview** tab in the UI uses for embedded iframes.

```mermaid
flowchart TD
  B[Browser] -->|/proxy/alice/3000/path| WS[Workshop Server]
  WS -->|Lookup port_mappings| DB[(SQLite)]
  WS -->|Forward to :49200/path| C[Craftsman Container]
  C -->|Response| WS
  WS -->|Response| B

  click WS href "#" "server/src/index.ts:17-19"
  click DB href "#" "server/src/db/schema.ts:16-27"
  click C href "#" "server/src/services/docker.ts:71-101"
```

## Checking Port Mappings

### Via the UI

Select a Craftsman — the **Preview** tab shows available ports and provides links.

### Via the API

```bash
curl http://localhost:7424/api/craftsmen/alice
# → {"port_mappings": "{\"3000\":49200}", ...}
```

Parse the `port_mappings` JSON string to get the mapping.

## Updating Ports

Port mappings are set when a Craftsman is created, based on the Project's `ports` field at that time. To change which ports are exposed:

### For new Craftsmen

Update the Project's `ports` field before creating a new Craftsman. New Craftsmen will use the updated port list.

### For existing Craftsmen

Port mappings cannot be changed on a running Craftsman. To update ports:

1. **Save your work** — commit and push any changes
2. **Delete** the Craftsman
3. **Update** the Project's port configuration
4. **Create** a new Craftsman

```mermaid
flowchart TD
  A[Commit & push changes] --> B[Delete Craftsman]
  B --> C[Update Project ports]
  C --> D[Create new Craftsman]
  D --> E[New port mappings allocated]

  click B href "#" "server/src/routes/craftsmen.ts:101-112"
  click C href "#" "server/src/routes/projects.ts"
  click D href "#" "server/src/routes/craftsmen.ts:16-60"
  click E href "#" "server/src/services/docker.ts:71-101"
```

## Port Allocation Details

The server scans ports 49200–49300 sequentially, skipping any that are already in use by other active Craftsmen. Each container port gets its own unique host port.

```mermaid
flowchart TD
  A[Project wants port 3000] --> B[Scan 49200-49300]
  B --> C{49200 in use?}
  C -->|Yes| D{49201 in use?}
  D -->|No| E[Allocate 49201]
  C -->|No| F[Allocate 49200]
  E --> G[Docker PortBindings: 3000/tcp → 0.0.0.0:49201]
  F --> G

  click B href "#" "server/src/services/docker.ts:28-34"
  click G href "#" "server/src/services/docker.ts:76-86"
```

The maximum number of mapped ports across all active Craftsmen is **101** (49200–49300 inclusive).

## Troubleshooting

**Port not reachable**: Ensure the service inside the container is binding to `0.0.0.0`, not `127.0.0.1`. Many dev servers default to localhost-only.

**Port conflict**: If you get a "no available ports" error, you've exhausted the 49200–49300 range. Delete unused Craftsmen to free up ports.

**Preview not loading**: The reverse proxy requires the Craftsman to be in `running` status. Check the Craftsman status and ensure the dev server is actually running inside the container.
