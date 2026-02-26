import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { findCraftsman } from "./craftsmen.js";
import { craftsmanEvents } from "../services/events.js";

const app = new Hono();

app.get("/:id/events", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);

  return streamSSE(c, async (stream) => {
    // Immediately send current state so client doesn't have to poll first
    await stream.writeSSE({
      event: "status",
      data: JSON.stringify({ id: craftsman.id, status: craftsman.status }),
    });

    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));

    const handler = async (payload: Record<string, unknown>) => {
      try {
        await stream.writeSSE({
          event: "status",
          data: JSON.stringify({ id: craftsman.id, ...payload }),
        });
      } catch {
        // Client disconnected
      }
      const s = payload.status as string;
      if (s === "running" || s === "stopped" || s === "error") resolve();
    };

    craftsmanEvents.on(`craftsman:${craftsman.id}`, handler);

    const pingInterval = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "{}" }).catch(() => {});
    }, 15_000);

    stream.onAbort(resolve);
    await done;

    craftsmanEvents.off(`craftsman:${craftsman.id}`, handler);
    clearInterval(pingInterval);
  });
});

export default app;
