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
  const allowedFields = ["name", "repo_url", "branch", "github_token", "setup_cmd", "ports"] as const;
  const updates: string[] = [];
  const values: any[] = [];

  for (const field of allowedFields) {
    if (!(field in body)) continue;

    if (field === "ports") {
      const ports = body.ports;
      if (!Array.isArray(ports) || !ports.every((p: any) => typeof p === "number" && Number.isInteger(p) && p > 0)) {
        return c.json({ error: "ports must be an array of positive integers" }, 400);
      }
      updates.push(`${field} = ?`);
      values.push(JSON.stringify(ports));
    } else {
      updates.push(`${field} = ?`);
      values.push(body[field] ?? null);
    }
  }

  if (updates.length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  values.push(id);
  db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...values);

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
