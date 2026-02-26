import { Hono } from "hono";
import { getContainerStats } from "../services/docker.js";
import { findCraftsman } from "./craftsmen.js";

const app = new Hono();

app.get("/:id/stats", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);
  if (!craftsman.container_id) return c.json({ error: "No container" }, 400);
  if (craftsman.status !== "running") {
    return c.json({ error: `Craftsman is ${craftsman.status}, not running` }, 400);
  }

  const stats = await getContainerStats(craftsman.container_id);
  return c.json({ id: craftsman.id, name: craftsman.name, ...stats });
});

export default app;
