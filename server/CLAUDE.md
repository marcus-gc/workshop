# Workshop Server

## What This Is

Workshop is a system for managing "Craftsmen" — Docker containers running Claude Code that work on GitHub repositories. This is the server component, exposing a REST API. A frontend will be built separately.

## Tech Stack

- **Runtime**: Node.js + TypeScript, executed via `tsx`
- **HTTP**: Hono framework with `@hono/node-server`
- **Database**: SQLite via `better-sqlite3` (raw SQL, no ORM)
- **Docker**: `dockerode` for container management
- **Proxy**: `http-proxy` for forwarding to container ports
- **IDs**: UUIDs via `uuid` package

## Project Structure

```
server/
├── src/
│   ├── index.ts                 # Entry point, raw HTTP server, proxy routing
│   ├── server.ts                # Hono app with route mounting
│   ├── types.ts                 # TypeScript interfaces (Project, Craftsman, Message, ClaudeResponse, StreamEvent)
│   ├── db/
│   │   ├── client.ts            # SQLite singleton (WAL mode, foreign keys on)
│   │   └── schema.ts            # CREATE TABLE migrations (run on startup)
│   ├── routes/
│   │   ├── projects.ts          # /api/projects — CRUD
│   │   ├── craftsmen.ts         # /api/craftsmen — CRUD + container lifecycle
│   │   ├── messages.ts          # /api/craftsmen/:id/messages — blocking Claude message send
│   │   ├── stream.ts            # /api/craftsmen/:id/messages/stream — SSE streaming Claude messages
│   │   ├── events.ts            # /api/craftsmen/:id/events — SSE craftsman status changes
│   │   ├── logs.ts              # /api/craftsmen/:id/logs — SSE container log stream
│   │   ├── git.ts               # /api/craftsmen/:id/diff|git/commit|git/push|git/pr
│   │   └── stats.ts             # /api/craftsmen/:id/stats — CPU/memory snapshot
│   └── services/
│       ├── docker.ts            # Container ops + git helpers + stats
│       ├── claude.ts            # sendMessage (blocking) + streamMessage (SSE) via docker exec
│       ├── events.ts            # In-process EventEmitter for craftsman state changes
│       └── proxy.ts             # http-proxy wrapper for forwarding to container ports
├── Dockerfile                   # Workshop server image (docker:27-dind + Node.js 22)
├── Dockerfile.craftsman         # Craftsman image (node:22-bookworm + git + Claude Code CLI)
├── entrypoint.sh                # Starts dockerd, waits for ready, then starts server
├── package.json
└── tsconfig.json
```

## Key Patterns

- **ESM modules** — `"type": "module"` in package.json, `.js` extensions in imports
- **Synchronous SQLite** — `better-sqlite3` uses sync API; no async/await for DB calls
- **Raw SQL** — No ORM. Prepared statements via `db.prepare().run()` / `.get()` / `.all()`
- **JSON-in-SQLite** — `ports` (array) and `port_mappings` (object) stored as JSON strings, parsed with `JSON.parse()`
- **Craftsman lookup** — Routes accept ID or name: `WHERE id = ? OR name = ?`
- **Async container startup** — `POST /api/craftsmen` returns immediately; container init runs in a fire-and-forget async IIFE
- **Proxy at HTTP level** — `/proxy/*` routes are handled in `index.ts` before Hono, on the raw Node.js `createServer` handler

## Database Schema

Three tables: `projects`, `craftsmen`, `messages`. See `src/db/schema.ts`. Key relationships:

- `craftsmen.project_id` → `projects.id` (foreign key)
- `craftsmen.id` ← `messages.craftsman_id` (foreign key)
- Deleting a craftsman cascades to delete its messages (done in application code, not DB cascade)
- Deleting a project is blocked if craftsmen exist

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/projects` | Create project (name, repo_url, branch, github_token, setup_cmd, ports) |
| GET | `/api/projects` | List projects |
| GET | `/api/projects/:id` | Get project |
| DELETE | `/api/projects/:id` | Delete project (409 if craftsmen exist) |
| POST | `/api/craftsmen` | Create craftsman (name, project_id) — starts container async |
| GET | `/api/craftsmen` | List craftsmen |
| GET | `/api/craftsmen/:id` | Get craftsman (by ID or name) |
| POST | `/api/craftsmen/:id/stop` | Stop container |
| POST | `/api/craftsmen/:id/start` | Start stopped container |
| DELETE | `/api/craftsmen/:id` | Remove container + data |
| POST | `/api/craftsmen/:id/messages` | Send message to Claude Code (synchronous, blocks until response) |
| POST | `/api/craftsmen/:id/messages/stream` | Send message, stream response as SSE (preferred) |
| GET | `/api/craftsmen/:id/messages` | Get message history |
| GET | `/api/craftsmen/:id/events` | SSE stream of craftsman status changes (replaces polling) |
| GET | `/api/craftsmen/:id/logs` | SSE stream of raw container logs |
| GET | `/api/craftsmen/:id/diff` | Git diff of uncommitted changes |
| POST | `/api/craftsmen/:id/git/commit` | Stage all and commit |
| POST | `/api/craftsmen/:id/git/push` | Push to `craftsman/<name>` branch |
| POST | `/api/craftsmen/:id/git/pr` | Open GitHub PR via GitHub API |
| GET | `/api/craftsmen/:id/stats` | One-shot CPU/memory snapshot |
| ALL | `/proxy/:nameOrId/:port/*` | Reverse proxy to container port |

## API Response Shapes

**Project** (returned from API — `github_token` is redacted):
```json
{
  "id": "uuid", "name": "string", "repo_url": "string", "branch": "string",
  "setup_cmd": "string|null", "ports": "[3000]", "has_github_token": true,
  "created_at": "datetime"
}
```

**Craftsman**:
```json
{
  "id": "uuid", "name": "string", "project_id": "uuid",
  "container_id": "string|null", "status": "pending|starting|running|stopped|error",
  "error_message": "string|null", "session_id": "string|null",
  "port_mappings": "{\"3000\":32768}", "created_at": "datetime", "updated_at": "datetime"
}
```

**Message**:
```json
{
  "id": "uuid", "craftsman_id": "uuid", "role": "user|assistant",
  "content": "string", "cost_usd": "number|null", "duration_ms": "number|null",
  "created_at": "datetime"
}
```

## Docker Architecture

Workshop runs as Docker-in-Docker (`docker:27-dind`, privileged). Craftsman containers are nested inside. The host only sees the Workshop container.

**Container startup flow** (in `services/docker.ts` + `routes/craftsmen.ts`):
1. Create container from `workshop-craftsman` image with port bindings and `ANTHROPIC_API_KEY`
2. Start container
3. `docker exec` git clone (token injected into URL for private repos)
4. `docker exec` setup command if set
5. Update DB status to `running`

**Claude Code communication** (in `services/claude.ts`):
- Each message is a `docker exec` running `claude -p "<message>" --output-format json --dangerously-skip-permissions`
- Session continuity via `--resume <session_id>` on subsequent messages
- Docker multiplexed stream headers are stripped before JSON parsing

## Running

```bash
# From repo root
export ANTHROPIC_API_KEY=sk-ant-...
docker compose up --build

# Server at http://localhost:7424
```

## Important Notes for Frontend Development

### Replacing polling with SSE events

**Don't poll** `GET /api/craftsmen/:id` in a loop. Instead subscribe to `GET /api/craftsmen/:id/events` which immediately emits the current status and then pushes each transition:

```ts
const es = new EventSource(`/api/craftsmen/${name}/events`);
es.addEventListener("status", (e) => {
  const { status, error_message } = JSON.parse(e.data);
  if (status === "running") { /* proceed */ }
  if (status === "error")   { /* show error_message */ }
});
// ping events can be ignored — they're just keepalives
```

### Prefer streaming messages over blocking

`POST /api/craftsmen/:id/messages` blocks for the full response (minutes). Prefer `POST /api/craftsmen/:id/messages/stream` which returns a `text/event-stream`:

```ts
const res = await fetch(`/api/craftsmen/${name}/messages/stream`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: "..." }),
});
const reader = res.body.getReader();
// Read chunks — each is an SSE event line

// Or parse with EventSource-compatible wrapper:
// event: system | assistant | tool_use | tool_result | result → forward to UI
// event: done   → { result, session_id, cost_usd, duration_ms, message_id }
// event: error  → { error: "..." }
```

The `done.message_id` can be used to link the UI to the persisted message record.

### Git workflow

After a craftsman has done work, the typical flow is:

1. `GET /diff` — show changed files in UI
2. `POST /git/commit` — let the user supply a commit message
3. `POST /git/push` — push to `craftsman/<name>` branch
4. `POST /git/pr` — open a PR; returns `pr_url` to link to

The push will fail if there are no commits yet. The PR will fail if the project has no `github_token` or the branch hasn't been pushed.

### Other key patterns

- `ports` and `port_mappings` are **JSON strings**, not parsed objects. Parse them client-side.
- `GET /api/craftsmen/:id/logs` returns raw container stdout/stderr as SSE. Each `data:` line is a log line. Useful for showing init progress.
- Proxy URLs follow `http://localhost:7424/proxy/{craftsmanName}/{port}/` — embed in iframes for live previews.
- All `:id` params accept either UUID or craftsman **name** for cleaner URLs.
- `github_token` is never returned in API responses — only `has_github_token: boolean` on project objects.
- `GET /api/craftsmen/:id/stats` is a one-shot REST call (not a stream) — poll it every few seconds if showing a live resource gauge.
