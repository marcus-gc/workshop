import { createServer, IncomingMessage, ServerResponse } from "http";
import { getRequestListener } from "@hono/node-server";
import app from "./server.js";
import { migrate } from "./db/schema.js";
import { ensureCraftsmanImage, reconcileContainers } from "./services/docker.js";
import { proxyRequest } from "./services/proxy.js";
import db from "./db/client.js";
import type { Craftsman } from "./types.js";

const PORT = parseInt(process.env.WORKSHOP_PORT || "7424", 10);

async function main() {
  migrate();
  console.log("Database initialized.");

  await ensureCraftsmanImage();
  await reconcileContainers();

  const requestHandler = getRequestListener(app.fetch);

  const server = createServer((req, res) => {
    if (req.url?.startsWith("/proxy/")) {
      handleProxyRoute(req, res);
      return;
    }
    requestHandler(req, res);
  });

  server.listen(PORT, () => {
    console.log(`Workshop server running on http://localhost:${PORT}`);
  });
}

function handleProxyRoute(req: IncomingMessage, res: ServerResponse) {
  const url = req.url!;
  const match = url.match(/^\/proxy\/([^/]+)\/(\d+)(\/.*)?$/);
  if (!match) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid proxy path. Use /proxy/:nameOrId/:port/path" }));
    return;
  }

  const [, nameOrId, portStr, path] = match;
  const craftsman = db
    .prepare("SELECT * FROM craftsmen WHERE id = ? OR name = ?")
    .get(nameOrId, nameOrId) as Craftsman | undefined;

  if (!craftsman) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Craftsman not found" }));
    return;
  }

  const portMappings = JSON.parse(craftsman.port_mappings) as Record<string, number>;
  const hostPort = portMappings[portStr];

  if (!hostPort) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Port ${portStr} not mapped for craftsman ${craftsman.name}`,
        available_ports: Object.keys(portMappings),
      })
    );
    return;
  }

  proxyRequest(req, res, hostPort, path || "/");
}

main().catch((err) => {
  console.error("Failed to start Workshop:", err);
  process.exit(1);
});
