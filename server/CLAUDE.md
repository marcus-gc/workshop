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
│   ├── types.ts                 # TypeScript interfaces (Project, Craftsman, Message, ClaudeResponse)
│   ├── db/
│   │   ├── client.ts            # SQLite singleton (WAL mode, foreign keys on)
│   │   └── schema.ts            # CREATE TABLE migrations (run on startup)
│   ├── routes/
│   │   ├── projects.ts          # /api/projects — CRUD
│   │   ├── craftsmen.ts         # /api/craftsmen — CRUD + container lifecycle
│   │   ├── messages.ts          # /api/craftsmen/:id/messages — Claude Code communication
│   │   └── logs.ts              # /api/craftsmen/:id/logs — SSE container log stream
│   └── services/
│       ├── docker.ts            # Container create/start/stop/remove, image building, exec
│       ├── claude.ts            # Sends messages to Claude Code via docker exec, parses JSON responses
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
| GET | `/api/craftsmen/:id/messages` | Get message history |
| GET | `/api/craftsmen/:id/logs` | SSE stream of container logs |
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

- `POST /api/craftsmen/:id/messages` is **synchronous and slow** — Claude Code can take seconds to minutes. The frontend should show a loading state and use a generous timeout (5+ minutes).
- `ports` and `port_mappings` are **JSON strings**, not parsed objects. Parse them client-side.
- Craftsman creation is **async** — the POST returns `status: "starting"`. Poll `GET /api/craftsmen/:id` until status is `"running"` or `"error"`.
- `GET /api/craftsmen/:id/logs` returns **Server-Sent Events**. Use `EventSource` in the browser.
- Proxy URLs follow the pattern `http://localhost:7424/proxy/{craftsmanName}/{port}/` — useful for embedding Craftsman project previews in iframes.
- All `:id` params in craftsmen routes also accept the craftsman's **name** for friendlier URLs.
