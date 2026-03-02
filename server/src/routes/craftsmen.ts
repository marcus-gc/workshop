import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import db from "../db/client.js";
import type { Craftsman, Project } from "../types.js";
import {
  createContainer,
  initContainer,
  stopContainer,
  startContainer,
  removeContainer,
} from "../services/docker.js";
import { emitStatusChange } from "../services/events.js";

const app = new Hono();

app.post("/", async (c) => {
  const body = await c.req.json();
  const { name, project_id, ports } = body;

  if (!name || !project_id) {
    return c.json({ error: "name and project_id are required" }, 400);
  }

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(project_id) as Project | undefined;
  if (!project) return c.json({ error: "Project not found" }, 404);

  // Validate optional ports override
  if (ports !== undefined) {
    const err = validatePorts(ports);
    if (err) return c.json({ error: err }, 400);
  }

  const id = uuid();
  const portsValue = ports !== undefined ? JSON.stringify(ports) : null;
  db.prepare(
    `INSERT INTO craftsmen (id, name, project_id, ports, status)
     VALUES (?, ?, ?, ?, 'starting')`
  ).run(id, name, project_id, portsValue);

  // Resolve effective ports: craftsman override or project default
  const effectivePorts: number[] = ports ?? JSON.parse(project.ports) as number[];

  // Start container async
  const craftsman = db.prepare("SELECT * FROM craftsmen WHERE id = ?").get(id) as Craftsman;

  (async () => {
    try {
      const { containerId, portMappings } = await createContainer(craftsman, project, effectivePorts);
      db.prepare(
        `UPDATE craftsmen SET container_id = ?, port_mappings = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(containerId, JSON.stringify(portMappings), id);

      await initContainer(containerId, project);

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

app.patch("/:id", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);

  if (craftsman.status !== "stopped") {
    return c.json({ error: "Craftsman must be stopped to update ports" }, 409);
  }

  const body = await c.req.json();
  const { ports } = body;

  const err = validatePorts(ports);
  if (err) return c.json({ error: err }, 400);

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(craftsman.project_id) as Project;

  // Remove old container
  if (craftsman.container_id) {
    await removeContainer(craftsman.container_id);
  }

  const portsValue = JSON.stringify(ports);
  db.prepare(
    "UPDATE craftsmen SET ports = ?, status = 'starting', updated_at = datetime('now') WHERE id = ?"
  ).run(portsValue, craftsman.id);
  emitStatusChange(craftsman.id, "starting");

  // Recreate container async (like POST)
  (async () => {
    try {
      const { containerId, portMappings } = await createContainer(craftsman, project, ports as number[]);
      db.prepare(
        `UPDATE craftsmen SET container_id = ?, port_mappings = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(containerId, JSON.stringify(portMappings), craftsman.id);

      await initContainer(containerId, project);

      db.prepare(
        "UPDATE craftsmen SET status = 'running', updated_at = datetime('now') WHERE id = ?"
      ).run(craftsman.id);
      emitStatusChange(craftsman.id, "running");
      console.log(`Craftsman ${craftsman.name} ports updated, now running.`);
    } catch (err: any) {
      console.error(`Failed to recreate craftsman ${craftsman.name}:`, err);
      db.prepare(
        "UPDATE craftsmen SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(err.message, craftsman.id);
      emitStatusChange(craftsman.id, "error", { error_message: err.message });
    }
  })();

  const updated = db.prepare("SELECT * FROM craftsmen WHERE id = ?").get(craftsman.id) as Craftsman;
  return c.json(updated);
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
    await removeContainer(craftsman.container_id);
  }

  db.prepare("DELETE FROM craftsmen WHERE id = ?").run(craftsman.id);

  return c.json({ ok: true });
});

function findCraftsman(idOrName: string): Craftsman | undefined {
  return (
    db.prepare("SELECT * FROM craftsmen WHERE id = ? OR name = ?").get(idOrName, idOrName) as Craftsman | undefined
  );
}

function validatePorts(ports: unknown): string | null {
  if (!Array.isArray(ports)) return "ports must be an array";
  for (const p of ports) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return "each port must be an integer between 1 and 65535";
    }
  }
  if (new Set(ports).size !== ports.length) {
    return "ports must not contain duplicates";
  }
  return null;
}

export { findCraftsman };
export default app;
