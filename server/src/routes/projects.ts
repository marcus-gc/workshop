import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import db from "../db/client.js";
import type { Project } from "../types.js";

const app = new Hono();

app.post("/", async (c) => {
  const body = await c.req.json();
  const { name, repo_url, branch, github_token, setup_cmd, ports } = body;

  if (!name || !repo_url) {
    return c.json({ error: "name and repo_url are required" }, 400);
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO projects (id, name, repo_url, branch, github_token, setup_cmd, ports)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, repo_url, branch || "main", github_token || null, setup_cmd || null, JSON.stringify(ports || []));

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project;
  return c.json(redactProject(project), 201);
});

app.get("/", (c) => {
  const projects = db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as Project[];
  return c.json(projects.map(redactProject));
});

app.get("/:id", (c) => {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(c.req.param("id")) as Project | undefined;
  if (!project) return c.json({ error: "Project not found" }, 404);
  return c.json(redactProject(project));
});

app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
  if (!project) return c.json({ error: "Project not found" }, 404);

  const body = await c.req.json();
  const { ports } = body;

  if (!Array.isArray(ports)) {
    return c.json({ error: "ports must be an array" }, 400);
  }

  for (const p of ports) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return c.json({ error: "each port must be an integer between 1 and 65535" }, 400);
    }
  }

  if (new Set(ports).size !== ports.length) {
    return c.json({ error: "ports must not contain duplicates" }, 400);
  }

  db.prepare("UPDATE projects SET ports = ? WHERE id = ?").run(JSON.stringify(ports), id);

  const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project;
  return c.json(redactProject(updated));
});

app.delete("/:id", (c) => {
  const id = c.req.param("id");
  const craftsmen = db
    .prepare("SELECT COUNT(*) as count FROM craftsmen WHERE project_id = ?")
    .get(id) as { count: number };

  if (craftsmen.count > 0) {
    return c.json({ error: "Cannot delete project with active craftsmen" }, 409);
  }

  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  if (result.changes === 0) return c.json({ error: "Project not found" }, 404);
  return c.json({ ok: true });
});

function redactProject(project: Project) {
  const { github_token, ...rest } = project;
  return { ...rest, has_github_token: !!github_token };
}

export default app;
