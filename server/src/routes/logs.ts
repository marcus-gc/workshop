import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { findCraftsman } from "./craftsmen.js";
import { getContainerLogs } from "../services/docker.js";

const app = new Hono();

app.get("/:id/logs", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);
  if (!craftsman.container_id) return c.json({ error: "No container" }, 400);

  const logStream = await getContainerLogs(craftsman.container_id);

  return streamSSE(c, async (stream) => {
    const nodeStream = logStream as unknown as NodeJS.ReadableStream;
    let rawBuffer = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      rawBuffer = Buffer.concat([rawBuffer, chunk]);

      // Extract complete Docker multiplexed frames (8-byte header per frame)
      while (rawBuffer.length >= 8) {
        const frameSize = rawBuffer.readUInt32BE(4);
        if (rawBuffer.length < 8 + frameSize) break;
        const payload = rawBuffer.subarray(8, 8 + frameSize).toString("utf8");
        rawBuffer = rawBuffer.subarray(8 + frameSize);

        const lines = payload.split("\n");
        for (const line of lines) {
          if (line.trim()) {
            stream.writeSSE({ data: line });
          }
        }
      }
    };

    nodeStream.on("data", onData);

    // Keep alive until client disconnects
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        nodeStream.removeListener("data", onData);
        resolve();
      });
      nodeStream.on("end", resolve);
    });
  });
});

export default app;
