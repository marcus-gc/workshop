import { createServer } from "http";
import { getRequestListener } from "@hono/node-server";
import app from "./server.js";
import { migrate } from "./db/schema.js";
import { ensureCraftsmanImage, reconcileContainers } from "./services/docker.js";
import { setupTerminalWebSocket } from "./services/websocket.js";
import { startBridges } from "./services/mcp-bridge.js";

const PORT = parseInt(process.env.WORKSHOP_PORT || "7424", 10);

async function main() {
  migrate();
  console.log("Database initialized.");

  await ensureCraftsmanImage();
  await startBridges();
  await reconcileContainers();

  const requestHandler = getRequestListener(app.fetch);

  const server = createServer(requestHandler);

  setupTerminalWebSocket(server);

  server.listen(PORT, () => {
    console.log(`Workshop server running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start Workshop:", err);
  process.exit(1);
});
