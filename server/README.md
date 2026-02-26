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

### Streaming Messages

Real-time alternative to `POST /messages`. Streams Claude's response token-by-token as Server-Sent Events rather than blocking until completion.

#### `POST /api/craftsmen/:id/messages/stream`

Send a message and receive a `text/event-stream` response. Each line Claude produces is forwarded immediately.

```json
{ "content": "Add a login page with email/password authentication" }
```

**Event stream format**:

```
event: system
data: {"type":"system","subtype":"init","session_id":"...","tools":[...]}

event: assistant
data: {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I'll start by..."}]}}

event: result
data: {"type":"result","result":"I've added the login page.","session_id":"...","total_cost_usd":0.03,"duration_ms":15000}

event: done
data: {"result":"I've added the login page.","session_id":"...","cost_usd":0.03,"duration_ms":15000,"message_id":"uuid"}
```

The `done` event is always the last event. Its `message_id` refers to the saved assistant message in the database. If anything fails, an `error` event is emitted instead:

```
event: error
data: {"error":"container exec failed"}
```

**Event types emitted before `done`**: match the `type` field in Claude Code's `stream-json` format — `system`, `assistant`, `tool_use`, `tool_result`, `result`. Clients can listen for all of them or just `done`.

**User message persistence**: The user message is saved to the DB *before* streaming begins. The assistant message is saved after `done`. Both appear in `GET /api/craftsmen/:id/messages`.

Session continuity works identically to the blocking endpoint — the `session_id` is updated on the craftsman after each successful response.

**Errors**: `404` if not found, `400` if Craftsman isn't running or content is missing.

---

### Craftsman Events

Subscribe to status changes without polling.

#### `GET /api/craftsmen/:id/events`

Returns a `text/event-stream`. Immediately emits the craftsman's current status, then streams further changes as they happen. Accepts ID or name.

```
event: status
data: {"id":"uuid","status":"starting"}

event: status
data: {"id":"uuid","status":"running"}

event: ping
data: {}
```

- The first `status` event is always sent immediately with the current state.
- Subsequent `status` events fire whenever the craftsman transitions state (e.g., `starting → running`, `running → stopped`, `running → error`).
- On `error` transitions, the payload includes `"error_message": "..."`.
- A `ping` event fires every 15 seconds as a keepalive.
- The stream stays open indefinitely until the client disconnects.

**Use this instead of polling** `GET /api/craftsmen/:id` after creating a craftsman.

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

### Git

Retrieve, commit, push, and PR changes made by a Craftsman.

#### `GET /api/craftsmen/:id/diff`

Get the current git diff (all uncommitted changes against HEAD).

**Response** `200`:
```json
{
  "diff": "diff --git a/src/login.tsx b/src/login.tsx\n+++ ...",
  "files_changed": ["src/login.tsx", "src/auth.ts"],
  "insertions": 42,
  "deletions": 8
}
```

Returns empty `diff` and zero counts if there are no changes.

**Errors**: `404` if not found, `400` if no container.

---

#### `POST /api/craftsmen/:id/git/commit`

Stage all changes (`git add -A`) and create a commit.

```json
{ "message": "Add login page with email/password auth" }
```

**Response** `200`:
```json
{
  "ok": true,
  "commit_sha": "abc1234",
  "files_changed": 3,
  "output": "[main abc1234] Add login page with email/password auth\n 3 files changed, 42 insertions(+), 8 deletions(-)"
}
```

**Response** `400` if nothing to commit:
```json
{ "ok": false, "error": "nothing to commit" }
```

**Errors**: `404` if not found, `400` if `message` is missing or no container.

---

#### `POST /api/craftsmen/:id/git/push`

Push the craftsman's commits to its dedicated branch (`craftsman/<name>`) on the remote. Force-pushes, so it's safe to call repeatedly.

**Response** `200`:
```json
{
  "ok": true,
  "branch": "craftsman/alice",
  "output": "To https://github.com/owner/repo.git\n * [new branch] ..."
}
```

**Errors**: `404` if not found, `400` if no container. Push may fail if the project has no GitHub token and the repo requires auth.

---

#### `POST /api/craftsmen/:id/git/pr`

Open a GitHub pull request from `craftsman/<name>` into the project's base branch. Requires the project to have a `github_token`.

```json
{
  "title": "Add login page",
  "body": "Implements email/password authentication with session management."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | PR title |
| `body` | string | no | PR description (Markdown) |

**Response** `200`:
```json
{
  "ok": true,
  "pr_url": "https://github.com/owner/repo/pull/42",
  "pr_number": 42
}
```

**Errors**: `404` if not found, `400` if `title` missing or no GitHub token, `422` if the branch doesn't exist on the remote (push first).

---

### Stats

#### `GET /api/craftsmen/:id/stats`

Get a one-shot CPU and memory snapshot for a running craftsman.

**Response** `200`:
```json
{
  "id": "uuid",
  "name": "alice",
  "cpu_percent": 12.4,
  "memory_mb": 387.2,
  "memory_limit_mb": 2048,
  "pids": 18
}
```

**Errors**: `404` if not found, `400` if no container or craftsman isn't running.

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
