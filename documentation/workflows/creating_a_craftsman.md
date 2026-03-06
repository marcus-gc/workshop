---
title: Creating a Craftsman
description: Step-by-step guide to hiring a new Craftsman via the UI or API.
tags: [craftsman, create, workflow]
---

## Prerequisites

- Workshop is [running](../how_tos/craftsman_setup)
- At least one [Project](../key_concepts/project) exists

## Via the Web UI

1. Click **New Craftsman** in the sidebar
2. Enter a name (e.g. `alice`) — must be unique, lowercase with hyphens only
3. Select the Project from the dropdown
4. Click **Create**

The Craftsman appears in the sidebar with a yellow status indicator (`starting`). The modal shows live startup logs. Once the status turns green (`running`), the modal closes and you can click on the Craftsman to open the terminal.

## Via the API

```bash
# First, get your project ID
curl http://localhost:7424/api/projects
# -> [{"id": "abc-123", "name": "my-app", ...}]

# Create the craftsman
curl -X POST http://localhost:7424/api/craftsmen \
  -H "Content-Type: application/json" \
  -d '{"name": "alice", "project_id": "abc-123"}'
# -> {"id": "def-456", "name": "alice", "status": "starting", ...}
```

The API returns immediately with `status: "starting"`. The container is initialized in the background.

### With a task

You can optionally provide a `task` to have Claude Code start working immediately:

```bash
curl -X POST http://localhost:7424/api/craftsmen \
  -H "Content-Type: application/json" \
  -d '{"name": "fixer", "project_id": "abc-123", "task": "Fix the broken tests in auth.spec.ts"}'
```

See [Assigning a Task](assigning_a_task) for the full task workflow.

## What Happens Behind the Scenes

```mermaid
sequenceDiagram
  participant U as You
  participant A as Workshop API
  participant DB as SQLite
  participant D as Docker Daemon

  U->>A: POST /api/craftsmen {name, project_id}
  A->>DB: INSERT craftsman (status: starting)
  A-->>U: 201 Created

  Note over A,D: Async initialization begins
  A->>D: createContainer (image, ports, env)
  D-->>A: container_id
  A->>DB: UPDATE container_id, port_mappings
  A->>D: Wait for inner dockerd
  A->>D: Configure MCP servers
  A->>D: git clone repo
  A->>D: run setup_cmd
  A->>D: tmux new-session -d -s main
  A->>DB: UPDATE status -> running
  A-->>U: SSE event: status = running

  click A href "#" "server/src/routes/craftsmen.ts:19-67"
  click D href "#" "server/src/services/docker.ts:85-140"
  click DB href "#" "server/src/db/schema.ts:16-27"
```

### Initialization steps

1. **Create container** — Docker container is created from the `workshop-craftsman` image with port bindings and `ANTHROPIC_API_KEY`
2. **Wait for dockerd** — The inner Docker daemon must be ready before Claude Code can use Docker tools
3. **Configure MCP** — Write MCP server URLs (from [bridges](../key_concepts/mcp_bridges)) into the container's Claude config
4. **Clone repo** — `git clone --branch {branch} {repo_url} /workspace/project` (token injected for private repos)
5. **Setup** — runs the project's `setup_cmd` if defined (e.g. `npm install`)
6. **tmux** — starts a detached tmux session named `main` in `/workspace/project`
7. **Task** — if a task was provided, starts Claude Code with the task in the tmux session
8. **Status update** — DB and SSE event updated to `running`

## Waiting for Ready State

### SSE (recommended)

Subscribe to the events stream to get notified when the Craftsman is ready:

```bash
curl -N http://localhost:7424/api/craftsmen/alice/events
# data: {"status":"starting","error_message":null}
# ... wait ...
# data: {"status":"running","error_message":null}
```

### Polling

Alternatively, poll the Craftsman endpoint:

```bash
curl http://localhost:7424/api/craftsmen/alice
# -> {"status": "running", ...}
```

## Error Handling

If initialization fails (bad repo URL, setup command error, etc.), the Craftsman status becomes `error` with an `error_message` explaining what went wrong.

```bash
curl http://localhost:7424/api/craftsmen/alice
# -> {"status": "error", "error_message": "fatal: repository not found", ...}
```

Delete the failed Craftsman and try again with corrected settings:

```bash
curl -X DELETE http://localhost:7424/api/craftsmen/alice
```
