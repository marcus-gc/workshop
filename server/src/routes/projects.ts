import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import db from "../db/client.js";
import type { Project, Craftsman } from "../types.js";
import { recreateContainerWithPorts } from "../services/docker.js";
import { emitStatusChange } from "../services/events.js";

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

  if (!Array.isArray(ports) || !ports.every((p: unknown) => typeof p === "number")) {
    return c.json({ error: "ports must be an array of numbers" }, 400);
  }

  // Update project ports in DB
  db.prepare("UPDATE projects SET ports = ? WHERE id = ?").run(JSON.stringify(ports), id);

  // Fetch updated project for recreating containers
  const updatedProject = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project;

  // Find all craftsmen with containers that need recreation
  const craftsmen = db
    .prepare("SELECT * FROM craftsmen WHERE project_id = ? AND container_id IS NOT NULL AND status IN ('running', 'stopped')")
    .all(id) as Craftsman[];

  // Recreate containers in the background
  for (const craftsman of craftsmen) {
    (async () => {
      try {
        const { containerId, portMappings } = await recreateContainerWithPorts(craftsman, updatedProject);
        db.prepare(
          "UPDATE craftsmen SET container_id = ?, port_mappings = ?, status = 'running', updated_at = datetime('now') WHERE id = ?"
        ).run(containerId, JSON.stringify(portMappings), craftsman.id);
        emitStatusChange(craftsman.id, "running", { port_mappings: JSON.stringify(portMappings) });
      } catch (err: any) {
        console.error(`Failed to recreate container for craftsman ${craftsman.name}:`, err);
        db.prepare(
          "UPDATE craftsmen SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(err.message, craftsman.id);
        emitStatusChange(craftsman.id, "error", { error_message: err.message });
      }
    })();
  }

  return c.json(redactProject(updatedProject));
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
