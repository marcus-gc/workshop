import { WebSocketServer, type WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import type { Duplex } from "stream";
import db from "../db/client.js";
import type { Craftsman } from "../types.js";
import { createTerminalExec } from "./terminal.js";

async function handleConnection(ws: WebSocket, craftsman: Craftsman, cols: number, rows: number): Promise<void> {
  try {
    const { stream, exec } = await createTerminalExec(
      craftsman.container_id!,
      cols,
      rows
    );

    // Docker stream → WebSocket (binary)
    stream.on("data", (chunk: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(chunk);
      }
    });

    stream.on("end", () => {
      if (ws.readyState === ws.OPEN) {
        ws.close(1000, "Stream ended");
      }
    });

    // WebSocket → Docker stream
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        stream.write(data);
      } else {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "resize" && msg.cols && msg.rows) {
            exec.resize({ w: msg.cols, h: msg.rows }).catch(() => {});
          }
        } catch {
          // Ignore malformed JSON
        }
      }
    });

    ws.on("close", () => {
      stream.end();
    });

    ws.on("error", () => {
      stream.end();
    });
  } catch (err) {
    console.error("Terminal WebSocket error:", err);
    ws.close(1011, "Failed to start terminal");
  }
}

export function setupTerminalWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const urlObj = new URL(req.url ?? "", `http://${req.headers.host}`);
    const match = urlObj.pathname.match(/^\/api\/craftsmen\/([^/]+)\/terminal$/);
    if (!match) {
      return;
    }

    const cols = parseInt(urlObj.searchParams.get("cols") ?? "80", 10) || 80;
    const rows = parseInt(urlObj.searchParams.get("rows") ?? "24", 10) || 24;

    const idOrName = decodeURIComponent(match[1]);
    const craftsman = db
      .prepare("SELECT * FROM craftsmen WHERE id = ? OR name = ?")
      .get(idOrName, idOrName) as Craftsman | undefined;

    if (!craftsman || craftsman.status !== "running" || !craftsman.container_id) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, craftsman, cols, rows);
    });
  });
}
