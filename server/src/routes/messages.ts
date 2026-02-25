import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import db from "../db/client.js";
import type { Craftsman, Message } from "../types.js";
import { sendMessage } from "../services/claude.js";
import { findCraftsman } from "./craftsmen.js";

const app = new Hono();

app.post("/:id/messages", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);
  if (craftsman.status !== "running") {
    return c.json({ error: `Craftsman is ${craftsman.status}, not running` }, 400);
  }
  if (!craftsman.container_id) {
    return c.json({ error: "No container" }, 400);
  }

  const body = await c.req.json();
  const { content } = body;
  if (!content) return c.json({ error: "content is required" }, 400);

  // Save user message
  const userMsgId = uuid();
  db.prepare(
    `INSERT INTO messages (id, craftsman_id, role, content) VALUES (?, ?, 'user', ?)`
  ).run(userMsgId, craftsman.id, content);

  // Send to Claude Code
  const response = await sendMessage(
    craftsman.container_id,
    content,
    craftsman.session_id
  );

  // Update session_id
  if (response.session_id) {
    db.prepare(
      "UPDATE craftsmen SET session_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(response.session_id, craftsman.id);
  }

  // Save assistant message
  const assistantMsgId = uuid();
  db.prepare(
    `INSERT INTO messages (id, craftsman_id, role, content, cost_usd, duration_ms)
     VALUES (?, ?, 'assistant', ?, ?, ?)`
  ).run(
    assistantMsgId,
    craftsman.id,
    response.result,
    response.cost_usd,
    response.duration_ms
  );

  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(assistantMsgId) as Message;
  return c.json(msg);
});

app.get("/:id/messages", (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);

  const messages = db
    .prepare("SELECT * FROM messages WHERE craftsman_id = ? ORDER BY created_at ASC")
    .all(craftsman.id);

  return c.json(messages);
});

export default app;
