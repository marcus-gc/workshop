import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";

const HOST_CONFIG_PATH = "/host-claude-config/claude.json";
const MCP_PORT_START = 48100;
const MCP_PORT_END = 48119;

/**
 * Get the Docker bridge gateway IP — this is how craftsman containers
 * (running on the inner DinD dockerd) can reach the Workshop container.
 * The `workshop` hostname is a Compose service name and doesn't resolve
 * from inside the inner Docker network.
 */
function getDockerGatewayIp(): string {
  try {
    const ip = execSync(
      "docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'",
      { encoding: "utf-8" }
    ).trim().replace(/'/g, "");
    if (ip) return ip;
  } catch {}
  // Fallback — standard Docker bridge gateway
  return "172.17.0.1";
}

let gatewayIp: string | null = null;

function getGateway(): string {
  if (!gatewayIp) {
    gatewayIp = getDockerGatewayIp();
    console.log(`MCP bridge gateway IP: ${gatewayIp}`);
  }
  return gatewayIp;
}

interface StdioMcpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface SseMcpServer {
  url: string;
}

type McpServerConfig = StdioMcpServer | SseMcpServer;

interface Bridge {
  name: string;
  port: number;
  process: ChildProcess;
  config: StdioMcpServer;
  status: "running" | "stopped" | "error";
  error?: string;
}

const bridges: Map<string, Bridge> = new Map();

/** Passthrough SSE/HTTP servers from host config (no bridge needed). */
const passthroughServers: Map<string, string> = new Map();

function isStdioServer(config: McpServerConfig): config is StdioMcpServer {
  return "command" in config;
}

function isSseServer(config: McpServerConfig): config is SseMcpServer {
  return "url" in config;
}

/**
 * Read the host's claude.json and extract mcpServers from project configs.
 * Claude stores MCP servers under projects[path].mcpServers.
 */
export function readHostMcpConfig(): Record<string, McpServerConfig> {
  if (!fs.existsSync(HOST_CONFIG_PATH)) {
    console.log("No host claude.json found at", HOST_CONFIG_PATH);
    return {};
  }

  try {
    const raw = JSON.parse(fs.readFileSync(HOST_CONFIG_PATH, "utf-8"));
    const servers: Record<string, McpServerConfig> = {};

    // MCP servers can be in projects[path].mcpServers
    if (raw.projects && typeof raw.projects === "object") {
      for (const projectConfig of Object.values(raw.projects) as any[]) {
        if (projectConfig?.mcpServers && typeof projectConfig.mcpServers === "object") {
          Object.assign(servers, projectConfig.mcpServers);
        }
      }
    }

    // Also check top-level mcpServers (some configs put them here)
    if (raw.mcpServers && typeof raw.mcpServers === "object") {
      Object.assign(servers, raw.mcpServers);
    }

    return servers;
  } catch (err) {
    console.error("Failed to parse host MCP config:", err);
    return {};
  }
}

function spawnBridge(name: string, config: StdioMcpServer, port: number): Bridge {
  const args = config.args ?? [];

  // Build the stdio command string for supergateway
  const stdioCmd = [config.command, ...args].join(" ");

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...config.env,
  };

  console.log(`Starting MCP bridge "${name}" on port ${port}: ${stdioCmd}`);

  const child = spawn("supergateway", ["--stdio", stdioCmd, "--port", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const bridge: Bridge = {
    name,
    port,
    process: child,
    config,
    status: "running",
  };

  child.stdout?.on("data", (data: Buffer) => {
    console.log(`[mcp:${name}] ${data.toString().trimEnd()}`);
  });

  child.stderr?.on("data", (data: Buffer) => {
    console.error(`[mcp:${name}] ${data.toString().trimEnd()}`);
  });

  child.on("exit", (code, signal) => {
    console.warn(`MCP bridge "${name}" exited (code=${code}, signal=${signal})`);
    bridge.status = "stopped";

    // Auto-restart after 3 seconds unless we're shutting down
    if (!shuttingDown) {
      setTimeout(() => {
        if (shuttingDown) return;
        console.log(`Restarting MCP bridge "${name}"...`);
        const restarted = spawnBridge(name, config, port);
        bridges.set(name, restarted);
      }, 3000);
    }
  });

  child.on("error", (err) => {
    console.error(`MCP bridge "${name}" error:`, err.message);
    bridge.status = "error";
    bridge.error = err.message;
  });

  return bridge;
}

let shuttingDown = false;

/**
 * Start supergateway bridges for all stdio MCP servers found in host config.
 * SSE/HTTP servers are stored as passthroughs (no bridge needed).
 */
export async function startBridges(): Promise<void> {
  const servers = readHostMcpConfig();
  const serverNames = Object.keys(servers);

  if (serverNames.length === 0) {
    console.log("No host MCP servers found.");
    return;
  }

  console.log(`Found ${serverNames.length} host MCP server(s): ${serverNames.join(", ")}`);

  let nextPort = MCP_PORT_START;

  for (const [name, config] of Object.entries(servers)) {
    if (isSseServer(config)) {
      // SSE/HTTP servers can be passed through directly to craftsmen
      passthroughServers.set(name, config.url);
      console.log(`MCP server "${name}" is SSE — passthrough at ${config.url}`);
      continue;
    }

    if (!isStdioServer(config)) {
      console.warn(`MCP server "${name}" has unknown config format, skipping.`);
      continue;
    }

    if (nextPort > MCP_PORT_END) {
      console.warn(`No more ports available for MCP bridge "${name}" (max ${MCP_PORT_END - MCP_PORT_START + 1} bridges)`);
      break;
    }

    const bridge = spawnBridge(name, config, nextPort);
    bridges.set(name, bridge);
    nextPort++;
  }

  // Give bridges a moment to start
  if (bridges.size > 0) {
    await new Promise((r) => setTimeout(r, 1000));
    console.log(`Started ${bridges.size} MCP bridge(s).`);
  }
}

/**
 * Returns MCP server URLs for craftsmen to use.
 * Map of server name → SSE URL reachable from craftsman containers.
 */
export function getBridgeUrls(): Record<string, { type: string; url: string }> {
  const urls: Record<string, { type: string; url: string }> = {};

  const gw = getGateway();

  // Bridged stdio servers → SSE on workshop host
  for (const [name, bridge] of bridges) {
    if (bridge.status === "running") {
      urls[name] = { type: "sse", url: `http://${gw}:${bridge.port}/sse` };
    }
  }

  // Passthrough SSE servers — rewrite localhost to gateway IP
  for (const [name, url] of passthroughServers) {
    const rewritten = url
      .replace("http://localhost:", `http://${gw}:`)
      .replace("http://127.0.0.1:", `http://${gw}:`);
    urls[name] = { type: "sse", url: rewritten };
  }

  return urls;
}

/**
 * Returns status info for all MCP bridges (for the API endpoint).
 */
export function getBridgeStatus(): Array<{
  name: string;
  type: "bridge" | "passthrough";
  status: string;
  port?: number;
  url: string;
  command?: string;
  error?: string;
}> {
  const result = [];

  for (const [name, bridge] of bridges) {
    result.push({
      name,
      type: "bridge" as const,
      status: bridge.status,
      port: bridge.port,
      url: `http://${getGateway()}:${bridge.port}/sse`,
      command: [bridge.config.command, ...(bridge.config.args ?? [])].join(" "),
      error: bridge.error,
    });
  }

  for (const [name, url] of passthroughServers) {
    result.push({
      name,
      type: "passthrough" as const,
      status: "passthrough",
      url,
    });
  }

  return result;
}

/**
 * Restart all bridges. Re-reads host config and respawns processes.
 * Call this after host auth tokens change (e.g., OAuth re-login).
 */
export async function restartBridges(): Promise<void> {
  console.log("Restarting all MCP bridges...");
  // Stop without setting shuttingDown so auto-restart doesn't interfere
  for (const [name, bridge] of bridges) {
    console.log(`Stopping MCP bridge "${name}"...`);
    bridge.process.kill("SIGTERM");
  }
  bridges.clear();
  passthroughServers.clear();
  await startBridges();
}

/** Gracefully stop all bridges. */
export function stopBridges(): void {
  shuttingDown = true;
  for (const [name, bridge] of bridges) {
    console.log(`Stopping MCP bridge "${name}"...`);
    bridge.process.kill("SIGTERM");
  }
  bridges.clear();
  passthroughServers.clear();
}

// Cleanup on process exit
process.on("SIGTERM", stopBridges);
process.on("SIGINT", stopBridges);
