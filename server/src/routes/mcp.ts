import { Hono } from "hono";
import { getBridgeStatus, getBridgeUrls, restartBridges } from "../services/mcp-bridge.js";

const mcp = new Hono();

/** List all MCP bridge servers and their status. */
mcp.get("/servers", (c) => {
  return c.json({
    servers: getBridgeStatus(),
    urls: getBridgeUrls(),
  });
});

/** Restart all MCP bridges (e.g., after host auth token changes). */
mcp.post("/restart", async (c) => {
  await restartBridges();
  return c.json({
    ok: true,
    servers: getBridgeStatus(),
  });
});

export default mcp;
