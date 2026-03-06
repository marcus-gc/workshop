---
title: Project
description: A GitHub repository configuration that Craftsmen are assigned to work on.
tags: [project, github, repository, concepts]
---

## What is a Project?

A Project is a GitHub repository configuration. It tells Workshop which repo to clone, which branch to use, what setup commands to run, and which ports to expose. Craftsmen are assigned to Projects — one Project can have many Craftsmen working on it.

## Project Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique display name for the project |
| `repo_url` | Yes | GitHub repository URL (HTTPS) |
| `branch` | No | Branch to clone (default: `main`) |
| `github_token` | No | Personal access token for private repos and PR creation |
| `setup_cmd` | No | Shell command to run after cloning (e.g. `npm install`) |
| `ports` | No | Array of container ports to expose (e.g. `[3000, 8080]`) |

## Creating a Project

```bash
curl -X POST http://localhost:7424/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "repo_url": "https://github.com/user/repo",
    "branch": "main",
    "setup_cmd": "npm install",
    "ports": [3000]
  }'
```

Or use the Settings pane in the web UI, which also supports importing repos directly from GitHub.

## Data Model

```mermaid
flowchart LR
  P[Project] -->|1:many| C[Craftsman]
  P -.->|repo_url| GH[GitHub Repo]

  click P href "#" "server/src/types.ts:1-10"
  click C href "#" "server/src/types.ts:12-24"
```

Projects are stored in SQLite with ports serialized as a JSON string.

```mermaid
flowchart TD
  A[POST /api/projects] --> B[Validate fields]
  B --> C[Store in SQLite]
  C --> D[Return project]

  click A href "#" "server/src/routes/projects.ts:10-26"
  click C href "#" "server/src/db/schema.ts:5-14"
```

## Updating Ports

Ports can be updated on an existing Project via `PATCH /api/projects/:id`. If any running Craftsmen are assigned to the project, their containers are **automatically recreated** with the new port mappings. The workspace is preserved.

```bash
curl -X PATCH http://localhost:7424/api/projects/abc-123 \
  -H "Content-Type: application/json" \
  -d '{"ports": [3000, 8080]}'
```

```mermaid
sequenceDiagram
  participant U as User
  participant A as API
  participant D as Docker

  U->>A: PATCH /api/projects/:id {ports}
  A->>A: Update DB
  loop For each running Craftsman
    A->>D: recreateContainerWithPorts()
    D-->>A: New container running
  end
  A-->>U: 200 OK

  click A href "#" "server/src/routes/projects.ts:39-82"
  click D href "#" "server/src/services/docker.ts:297-368"
```

## GitHub Token

The `github_token` field enables two things:

1. **Private repo access** — the token is injected into the clone URL as `x-access-token`
2. **Pull request creation** — required for `POST /api/craftsmen/:id/git/pr`

For security, the token is **never returned** in API responses. Instead, the API returns `has_github_token: true/false`.

```mermaid
sequenceDiagram
  participant A as API
  participant D as Docker
  participant GH as GitHub

  A->>D: git clone https://x-access-token:{token}@github.com/...
  D-->>A: Cloned
  Note over A: Token stored server-side only
  A-->>A: API returns has_github_token: true

  click A href "#" "server/src/services/docker.ts:196-215"
```

## Ports

The `ports` array specifies which container ports should be accessible from the host. When a Craftsman starts, each port is mapped to a unique host port in the range 49200–49300.

For example, if a project has `ports: [3000]` and the Craftsman gets allocated host port 49200, the service is accessible at `http://localhost:49200`.

See [Architecture](architecture) for details on port forwarding.

## Deleting a Project

A Project cannot be deleted while Craftsmen are assigned to it. Remove all Craftsmen first, then delete the project.

```bash
# Fails with 409 if craftsmen exist
curl -X DELETE http://localhost:7424/api/projects/abc-123
```
