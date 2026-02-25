# Workshop

Workshop hires and manages **Craftsmen** — Docker containers running [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that work on your GitHub repositories. Give a Craftsman a repo, talk to it through a REST API, and watch it build.

## How It Works

```
You ──REST API──▶ Workshop Server ──docker exec──▶ Craftsman (Claude Code)
                       │                                   │
                       │ reverse proxy                     │ git clone
                       ▼                                   ▼
                  localhost:7424                    Your GitHub repo
                  /proxy/alice/3000/               /workspace/project
```

1. **Create a Project** — point it at a GitHub repo (public or private)
2. **Hire a Craftsman** — Workshop spins up a Docker container, clones the repo, and runs your setup command
3. **Give instructions** — send messages through the API and get back Claude Code's responses
4. **See the results** — access running services through the built-in reverse proxy

Workshop runs entirely inside Docker (Docker-in-Docker), so Craftsman containers never touch your host machine.

## Quick Start

```bash
export ANTHROPIC_API_KEY=sk-ant-...
docker compose up --build
```

The server starts at `http://localhost:7424`. Then:

```bash
# Create a project
curl -X POST http://localhost:7424/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "repo_url": "https://github.com/user/repo",
    "setup_cmd": "npm install",
    "ports": [3000]
  }'

# Hire a craftsman
curl -X POST http://localhost:7424/api/craftsmen \
  -H "Content-Type: application/json" \
  -d '{"name": "alice", "project_id": "<id-from-above>"}'

# Wait for status "running", then talk to it
curl -X POST http://localhost:7424/api/craftsmen/alice/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Add a landing page with a hero section"}'

# Access what Alice is serving
curl http://localhost:7424/proxy/alice/3000/
```

## Project Structure

```
workshop/
├── docker-compose.yml       # One command to launch everything
├── server/                  # Workshop server (TypeScript, Hono, SQLite)
│   ├── README.md            # API documentation
│   └── src/
└── example-project/         # Sample Next.js app for testing Craftsmen
    └── WORKSHOP.md
```

See [server/README.md](server/README.md) for full API documentation.

## Concepts

| Concept | What it is |
|---------|------------|
| **Workshop** | The server that manages everything. Runs inside Docker with its own Docker daemon (DinD). |
| **Craftsman** | A Docker container with Claude Code. Has a name, works on one Project, remembers conversation history. |
| **Project** | A GitHub repository. Defines the repo URL, branch, setup command, and which ports to expose. |

## Private Repos

Pass a `github_token` when creating a project:

```bash
curl -X POST http://localhost:7424/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "private-app",
    "repo_url": "https://github.com/you/private-repo",
    "github_token": "ghp_your_token",
    "setup_cmd": "npm install",
    "ports": [3000]
  }'
```

The token is used for cloning and never returned in API responses.

## Requirements

- Docker with Compose v2
- An [Anthropic API key](https://console.anthropic.com/)
