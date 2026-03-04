import { Hono } from "hono";
import { findCraftsman } from "./craftsmen.js";
import {
  addPortProxy,
  removePortProxy,
} from "../services/port-proxy.js";

const app = new Hono();

app.post("/:id/ports", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);
  if (craftsman.status !== "running" || !craftsman.container_id) {
    return c.json({ error: "Craftsman is not running" }, 400);
  }

  const body = await c.req.json();
  const port = body.port;
  if (!port || typeof port !== "number" || port <= 0 || !Number.isInteger(port)) {
    return c.json({ error: "port must be a positive integer" }, 400);
  }

  try {
    const result = await addPortProxy(craftsman.id, craftsman.container_id, port);

    // Re-read craftsman to get updated port_mappings
    const updated = findCraftsman(craftsman.id);
    return c.json({
      container_port: result.containerPort,
      host_port: result.hostPort,
      port_mappings: updated ? JSON.parse(updated.port_mappings) : {},
    }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.delete("/:id/ports/:port", (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);

  const port = parseInt(c.req.param("port"), 10);
  if (isNaN(port) || port <= 0) {
    return c.json({ error: "Invalid port" }, 400);
  }

  // Only allow removing dynamic ports
  const dynPorts = JSON.parse(craftsman.dynamic_ports || "[]") as number[];
  if (!dynPorts.includes(port)) {
    return c.json({ error: "Port is not a dynamic port forward" }, 400);
  }

  removePortProxy(craftsman.id, port);

  const updated = findCraftsman(craftsman.id);
  return c.json({
    ok: true,
    port_mappings: updated ? JSON.parse(updated.port_mappings) : {},
  });
});

app.get("/:id/ports", (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);

  const mappings = JSON.parse(craftsman.port_mappings) as Record<string, number>;
  const dynPorts = new Set(JSON.parse(craftsman.dynamic_ports || "[]") as number[]);

  const ports = Object.entries(mappings).map(([containerPort, hostPort]) => ({
    container_port: parseInt(containerPort, 10),
    host_port: hostPort,
    dynamic: dynPorts.has(parseInt(containerPort, 10)),
  }));

  return c.json(ports);
});

export default app;
