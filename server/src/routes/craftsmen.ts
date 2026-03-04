import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import db from "../db/client.js";
import type { Craftsman, Project } from "../types.js";
import {
  createContainer,
  initContainer,
  startClaudeWithTask,
  stopContainer,
  startContainer,
  removeContainer,
} from "../services/docker.js";
import { emitStatusChange } from "../services/events.js";

const app = new Hono();

app.post("/", async (c) => {
  const body = await c.req.json();
  const { name, project_id, task } = body;

  if (!name || !project_id) {
    return c.json({ error: "name and project_id are required" }, 400);
  }

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(project_id) as Project | undefined;
  if (!project) return c.json({ error: "Project not found" }, 404);

  const id = uuid();
  db.prepare(
    `INSERT INTO craftsmen (id, name, project_id, status, task)
     VALUES (?, ?, ?, 'starting', ?)`
  ).run(id, name, project_id, task ?? null);

  // Start container async
  const craftsman = db.prepare("SELECT * FROM craftsmen WHERE id = ?").get(id) as Craftsman;

  (async () => {
    try {
      const { containerId, portMappings } = await createContainer(craftsman, project);
      db.prepare(
        `UPDATE craftsmen SET container_id = ?, port_mappings = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(containerId, JSON.stringify(portMappings), id);

      await initContainer(containerId, project);

      if (task) {
        await startClaudeWithTask(containerId, task);
      }

      db.prepare(
        "UPDATE craftsmen SET status = 'running', updated_at = datetime('now') WHERE id = ?"
      ).run(id);
      emitStatusChange(id, "running");
      console.log(`Craftsman ${name} is running.`);
    } catch (err: any) {
      console.error(`Failed to start craftsman ${name}:`, err);
      db.prepare(
        "UPDATE craftsmen SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(err.message, id);
      emitStatusChange(id, "error", { error_message: err.message });
    }
  })();

  return c.json({ ...craftsman, status: "starting" }, 201);
});

app.get("/", (c) => {
  const craftsmen = db.prepare("SELECT * FROM craftsmen ORDER BY created_at DESC").all();
  return c.json(craftsmen);
});

app.get("/:id", (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);
  return c.json(craftsman);
});

app.post("/:id/stop", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);
  if (!craftsman.container_id) return c.json({ error: "No container" }, 400);

  await stopContainer(craftsman.container_id);
  db.prepare(
    "UPDATE craftsmen SET status = 'stopped', updated_at = datetime('now') WHERE id = ?"
  ).run(craftsman.id);
  emitStatusChange(craftsman.id, "stopped");

  return c.json({ ...craftsman, status: "stopped" });
});

app.post("/:id/start", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);
  if (!craftsman.container_id) return c.json({ error: "No container" }, 400);

  await startContainer(craftsman.container_id);
  db.prepare(
    "UPDATE craftsmen SET status = 'running', updated_at = datetime('now') WHERE id = ?"
  ).run(craftsman.id);
  emitStatusChange(craftsman.id, "running");

  return c.json({ ...craftsman, status: "running" });
});

app.delete("/:id", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);

  if (craftsman.container_id) {
    await removeContainer(craftsman.container_id, craftsman.name);
  }

  db.prepare("DELETE FROM craftsmen WHERE id = ?").run(craftsman.id);

  return c.json({ ok: true });
});

function findCraftsman(idOrName: string): Craftsman | undefined {
  return (
    db.prepare("SELECT * FROM craftsmen WHERE id = ? OR name = ?").get(idOrName, idOrName) as Craftsman | undefined
  );
}

export { findCraftsman };
export default app;
