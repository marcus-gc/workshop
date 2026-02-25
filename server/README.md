# Workshop Server

Workshop manages **Craftsmen** — Docker containers running Claude Code that work on GitHub repositories. You create Projects (GitHub repos), assign Craftsmen to them, and communicate with Claude Code through a REST API.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Workshop Container (Docker-in-Docker)       │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Workshop Server (:7424)               │  │
│  │  Hono + SQLite + dockerode             │  │
│  └──────────┬─────────────────────────────┘  │
│             │                                │
│  ┌──────────▼───┐  ┌──────────────────────┐  │
│  │  Craftsman A  │  │  Craftsman B         │  │
│  │  (container)  │  │  (container)         │  │
│  │  Claude Code  │  │  Claude Code         │  │
│  │  :3000 → web  │  │  :3000 → web         │  │
│  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────┘
```

The server runs inside a Docker-in-Docker container. Craftsman containers are created inside this DinD environment, fully isolated from your host machine.

## Quick Start

```bash
# Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start Workshop (from repo root)
docker compose up --build

# Server is now running at http://localhost:7424
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | *required* | Passed into Craftsman containers for Claude Code |
| `WORKSHOP_PORT` | `7424` | Server listen port |
| `WORKSHOP_DB_PATH` | `./workshop.db` | SQLite database file path |

## API Reference

Base URL: `http://localhost:7424`

### Health

#### `GET /api/health`

```json
{ "status": "ok" }
```

---

### Projects

A Project is a GitHub repository that Craftsmen work on.

#### `POST /api/projects`

Create a project.

```json
{
  "name": "my-app",
  "repo_url": "https://github.com/user/repo",
  "branch": "main",
  "github_token": "ghp_xxxx",
  "setup_cmd": "npm install",
  "ports": [3000]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique project name |
| `repo_url` | string | yes | GitHub repository URL |
| `branch` | string | no | Branch to clone (default: `main`) |
| `github_token` | string | no | GitHub token for private repos |
| `setup_cmd` | string | no | Command to run after cloning (e.g., `npm install`) |
| `ports` | number[] | no | Ports the project exposes (e.g., `[3000]`) |

**Response** `201`:

```json
{
  "id": "uuid",
  "name": "my-app",
  "repo_url": "https://github.com/user/repo",
  "branch": "main",
  "setup_cmd": "npm install",
  "ports": "[3000]",
  "has_github_token": true,
  "created_at": "2026-02-25 12:00:00"
}
```

Note: `github_token` is never returned in responses. The `has_github_token` boolean indicates whether one is set. The `ports` field is a JSON-encoded string array.

#### `GET /api/projects`

List all projects. Returns an array of project objects.

#### `GET /api/projects/:id`

Get a single project by ID.

**Errors**: `404` if not found.

#### `DELETE /api/projects/:id`

Delete a project. Fails if any Craftsmen are assigned to it.

**Errors**: `404` if not found, `409` if Craftsmen exist for this project.

---

### Craftsmen

A Craftsman is a Docker container running Claude Code, assigned to a Project.

#### `POST /api/craftsmen`

Create a Craftsman and start its container.

```json
{
  "name": "alice",
  "project_id": "uuid-of-project"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique craftsman name |
| `project_id` | string | yes | Project to assign |

**Response** `201`:

```json
{
  "id": "uuid",
  "name": "alice",
  "project_id": "uuid",
  "container_id": null,
  "status": "starting",
  "error_message": null,
  "session_id": null,
  "port_mappings": "{}",
  "created_at": "2026-02-25 12:00:00",
  "updated_at": "2026-02-25 12:00:00"
}
```

The container starts asynchronously. Poll `GET /api/craftsmen/:id` until `status` becomes `"running"`.

**Status values**: `pending` → `starting` → `running` | `stopped` | `error`

**Errors**: `400` if fields missing, `404` if project not found.

#### `GET /api/craftsmen`

List all Craftsmen. Returns an array of craftsman objects.

#### `GET /api/craftsmen/:id`

Get a Craftsman by ID or name. The `port_mappings` field is a JSON-encoded object mapping container ports to host ports (e.g., `{"3000": 32768}`).

**Errors**: `404` if not found.

#### `POST /api/craftsmen/:id/stop`

Stop a Craftsman's container. Accepts ID or name.

**Errors**: `404` if not found, `400` if no container.

#### `POST /api/craftsmen/:id/start`

Restart a stopped Craftsman's container. Accepts ID or name.

**Errors**: `404` if not found, `400` if no container.

#### `DELETE /api/craftsmen/:id`

Stop and remove the container, delete all messages, delete the Craftsman record. Accepts ID or name.

**Errors**: `404` if not found.

---

### Messages

Send instructions to a Craftsman's Claude Code instance and get responses.

#### `POST /api/craftsmen/:id/messages`

Send a message to a Craftsman. This is **synchronous** — it blocks until Claude Code finishes (can take seconds to minutes). Set a generous client timeout.

```json
{
  "content": "Add a login page with email/password authentication"
}
```

**Response** `200`:

```json
{
  "id": "uuid",
  "craftsman_id": "uuid",
  "role": "assistant",
  "content": "I'll add a login page. Let me start by...",
  "cost_usd": 0.03,
  "duration_ms": 15000,
  "created_at": "2026-02-25 12:00:00"
}
```

Session continuity is automatic — the Craftsman remembers previous messages via Claude Code's `--resume` flag.

**Errors**: `404` if not found, `400` if Craftsman isn't running or content is missing.

#### `GET /api/craftsmen/:id/messages`

Get full message history for a Craftsman, ordered chronologically. Accepts ID or name.

**Response** `200`:

```json
[
  {
    "id": "uuid",
    "craftsman_id": "uuid",
    "role": "user",
    "content": "Add a login page",
    "cost_usd": null,
    "duration_ms": null,
    "created_at": "2026-02-25 12:00:00"
  },
  {
    "id": "uuid",
    "craftsman_id": "uuid",
    "role": "assistant",
    "content": "I'll add a login page...",
    "cost_usd": 0.03,
    "duration_ms": 15000,
    "created_at": "2026-02-25 12:00:01"
  }
]
```

**Errors**: `404` if not found.

---

### Logs

Stream live container output via Server-Sent Events.

#### `GET /api/craftsmen/:id/logs`

Returns a `text/event-stream`. Sends the last 100 lines of container output, then follows new output until the client disconnects.

```
data: Installing dependencies...
data: npm install completed.
data: Starting dev server on port 3000...
```

**Errors**: `404` if not found, `400` if no container.

---

### Proxy

Access services running inside a Craftsman's container.

#### `ANY /proxy/:nameOrId/:port/*`

Proxies any HTTP request to a Craftsman's container port. Accepts ID or name.

**Examples**:
```
GET  /proxy/alice/3000/           → Craftsman "alice", port 3000, path /
POST /proxy/alice/3000/api/users  → Craftsman "alice", port 3000, path /api/users
GET  /proxy/abc123/8080/health    → Craftsman by ID, port 8080, path /health
```

**Errors**: `400` if invalid path format, `404` if Craftsman not found or port not mapped (returns `available_ports` list), `502` if nothing is listening on that port in the container.

---

## Database

SQLite with WAL mode. Three tables:

- **projects** — GitHub repos with optional auth and port config
- **craftsmen** — Docker containers with status tracking and session state
- **messages** — Conversation history between users and Claude Code

All IDs are UUIDs. Timestamps are UTC.

## Tech Stack

| Package | Purpose |
|---------|---------|
| Hono | HTTP framework |
| better-sqlite3 | SQLite (synchronous) |
| dockerode | Docker Engine API client |
| http-proxy | Reverse proxy to container ports |
| tsx | TypeScript runtime |

## Development

```bash
cd server
npm install
npm run dev     # Requires Docker daemon access — intended to run inside DinD
```
