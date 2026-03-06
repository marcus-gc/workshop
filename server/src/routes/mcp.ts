import { Hono } from "hono";
import { getBridgeStatus, readHostMcpConfig, restartBridges } from "../services/mcp-bridge.js";

const mcp = new Hono();

/** List all MCP bridge servers and their status. */
mcp.get("/servers", (c) => {
  const hostConfig = readHostMcpConfig();
  const hostServers = Object.entries(hostConfig).map(([name, config]) => ({
    name,
    type: "command" in config ? "stdio" : "sse",
    command: "command" in config
      ? [config.command, ...((config as any).args ?? [])].join(" ")
      : undefined,
    url: "url" in config ? (config as any).url : undefined,
  }));

  return c.json({
    hostServers,
    activeBridges: getBridgeStatus(),
  });
});

/** Restart all MCP bridges (e.g., after host auth token changes). */
mcp.post("/restart", async (c) => {
  await restartBridges();
  return c.json({
    ok: true,
    activeBridges: getBridgeStatus(),
  });
});

export default mcp;
