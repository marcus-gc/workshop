import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { v4 as uuid } from "uuid";
import db from "../db/client.js";
import { streamMessage } from "../services/claude.js";
import { findCraftsman } from "./craftsmen.js";

const app = new Hono();

app.post("/:id/messages/stream", async (c) => {
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

  // Save user message before streaming begins
  const userMsgId = uuid();
  db.prepare(
    `INSERT INTO messages (id, craftsman_id, role, content) VALUES (?, ?, 'user', ?)`
  ).run(userMsgId, craftsman.id, content);

  return streamSSE(c, async (stream) => {
    try {
      const response = await streamMessage(
        craftsman.container_id!,
        content,
        craftsman.session_id,
        (event) => {
          stream.writeSSE({ event: event.type, data: JSON.stringify(event) }).catch(() => {});
        }
      );

      if (response.session_id) {
        db.prepare(
          "UPDATE craftsmen SET session_id = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(response.session_id, craftsman.id);
      }

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

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ type: "done", ...response, message_id: assistantMsgId }),
      });
    } catch (err: any) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: err.message }),
      });
    }
  });
});

export default app;
