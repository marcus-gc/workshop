import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";

const HOST_CONFIG_PATH = "/host-claude-config/claude.json";
const MCP_PORT_START = 48100;
const MCP_PORT_END = 48399;

// ── Docker gateway detection ─────────────────────────────────────────────────

/**
 * Get the Docker bridge gateway IP — this is how craftsman containers
 * (running on the inner DinD dockerd) can reach the Workshop container.
 */
function getDockerGatewayIp(): string {
  try {
    const ip = execSync(
      "docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'",
      { encoding: "utf-8" }
    ).trim().replace(/'/g, "");
    if (ip) return ip;
  } catch {}
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

// ── Host config parsing ──────────────────────────────────────────────────────

interface StdioMcpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface SseMcpServer {
  url: string;
}

type McpServerConfig = StdioMcpServer | SseMcpServer;

function isStdioServer(config: McpServerConfig): config is StdioMcpServer {
  return "command" in config;
}

function isSseServer(config: McpServerConfig): config is SseMcpServer {
  return "url" in config;
}

/** Parsed host MCP config — cached after first read. */
let cachedHostConfig: Record<string, McpServerConfig> | null = null;

/**
 * Read the host's claude.json and extract mcpServers from project configs.
 */
export function readHostMcpConfig(): Record<string, McpServerConfig> {
  if (!fs.existsSync(HOST_CONFIG_PATH)) {
    console.log("No host claude.json found at", HOST_CONFIG_PATH);
    return {};
  }

  try {
    const raw = JSON.parse(fs.readFileSync(HOST_CONFIG_PATH, "utf-8"));
    const servers: Record<string, McpServerConfig> = {};

    if (raw.projects && typeof raw.projects === "object") {
      for (const projectConfig of Object.values(raw.projects) as any[]) {
        if (projectConfig?.mcpServers && typeof projectConfig.mcpServers === "object") {
          Object.assign(servers, projectConfig.mcpServers);
        }
      }
    }

    if (raw.mcpServers && typeof raw.mcpServers === "object") {
      Object.assign(servers, raw.mcpServers);
    }

    return servers;
  } catch (err) {
    console.error("Failed to parse host MCP config:", err);
    return {};
  }
}

function getHostConfig(): Record<string, McpServerConfig> {
  if (!cachedHostConfig) {
    cachedHostConfig = readHostMcpConfig();
  }
  return cachedHostConfig;
}

// ── Per-craftsman bridge management ──────────────────────────────────────────

interface Bridge {
  name: string;
  port: number;
  process: ChildProcess;
  config: StdioMcpServer;
  status: "running" | "stopped" | "error";
  error?: string;
}

/**
 * Bridges keyed by craftsmanId → Map of serverName → Bridge.
 * Each craftsman gets its own dedicated supergateway instances.
 */
const craftsmanBridges: Map<string, Map<string, Bridge>> = new Map();

/** Track all used ports across all craftsmen. */
const usedPorts = new Set<number>();

function allocateBridgePort(): number {
  for (let port = MCP_PORT_START; port <= MCP_PORT_END; port++) {
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new Error(`No available MCP bridge ports in range ${MCP_PORT_START}-${MCP_PORT_END}`);
}

function releaseBridgePort(port: number): void {
  usedPorts.delete(port);
}

let shuttingDown = false;

function spawnBridge(label: string, config: StdioMcpServer, port: number): Bridge {
  const stdioCmd = [config.command, ...(config.args ?? [])].join(" ");

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...config.env,
  };

  console.log(`Starting MCP bridge "${label}" on port ${port}: ${stdioCmd}`);

  const child = spawn("supergateway", ["--stdio", stdioCmd, "--port", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const bridge: Bridge = {
    name: label,
    port,
    process: child,
    config,
    status: "running",
  };

  child.stdout?.on("data", (data: Buffer) => {
    console.log(`[mcp:${label}] ${data.toString().trimEnd()}`);
  });

  child.stderr?.on("data", (data: Buffer) => {
    console.error(`[mcp:${label}] ${data.toString().trimEnd()}`);
  });

  child.on("exit", (code, signal) => {
    console.warn(`MCP bridge "${label}" exited (code=${code}, signal=${signal})`);
    bridge.status = "stopped";
  });

  child.on("error", (err) => {
    console.error(`MCP bridge "${label}" error:`, err.message);
    bridge.status = "error";
    bridge.error = err.message;
  });

  return bridge;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize at boot — just parse the config and log what's available.
 * No bridges are started yet; they're started per-craftsman.
 */
export async function startBridges(): Promise<void> {
  cachedHostConfig = readHostMcpConfig();
  const names = Object.keys(cachedHostConfig);
  if (names.length === 0) {
    console.log("No host MCP servers found.");
  } else {
    console.log(`Found ${names.length} host MCP server(s): ${names.join(", ")}`);
    console.log("Bridges will be started per-craftsman on demand.");
  }
}

/**
 * Start dedicated supergateway bridges for a specific craftsman.
 * Each craftsman gets its own process per stdio MCP server.
 */
export async function startCraftsmanBridges(craftsmanId: string): Promise<void> {
  const servers = getHostConfig();
  if (Object.keys(servers).length === 0) return;

  // Clean up any existing bridges for this craftsman (e.g., on rebuild)
  await stopCraftsmanBridges(craftsmanId);

  const bridgeMap = new Map<string, Bridge>();

  for (const [name, config] of Object.entries(servers)) {
    if (!isStdioServer(config)) continue;

    try {
      const port = allocateBridgePort();
      const label = `${name}@${craftsmanId.slice(0, 8)}`;
      const bridge = spawnBridge(label, config, port);
      bridgeMap.set(name, bridge);
    } catch (err) {
      console.error(`Failed to start bridge "${name}" for craftsman ${craftsmanId}:`, err);
    }
  }

  if (bridgeMap.size > 0) {
    craftsmanBridges.set(craftsmanId, bridgeMap);
    // Give bridges a moment to start
    await new Promise((r) => setTimeout(r, 1000));
    console.log(`Started ${bridgeMap.size} MCP bridge(s) for craftsman ${craftsmanId.slice(0, 8)}.`);
  }
}

/**
 * Stop and clean up all bridges for a specific craftsman.
 */
export async function stopCraftsmanBridges(craftsmanId: string): Promise<void> {
  const bridgeMap = craftsmanBridges.get(craftsmanId);
  if (!bridgeMap) return;

  for (const [name, bridge] of bridgeMap) {
    console.log(`Stopping MCP bridge "${name}" for craftsman ${craftsmanId.slice(0, 8)}...`);
    bridge.process.kill("SIGTERM");
    releaseBridgePort(bridge.port);
  }

  craftsmanBridges.delete(craftsmanId);
}

/**
 * Returns MCP server URLs for a specific craftsman.
 * Includes both per-craftsman bridges and passthrough SSE servers.
 */
export function getBridgeUrls(craftsmanId: string): Record<string, { type: string; url: string }> {
  const urls: Record<string, { type: string; url: string }> = {};
  const gw = getGateway();
  const servers = getHostConfig();

  // Per-craftsman bridges
  const bridgeMap = craftsmanBridges.get(craftsmanId);
  if (bridgeMap) {
    for (const [name, bridge] of bridgeMap) {
      if (bridge.status === "running") {
        urls[name] = { type: "sse", url: `http://${gw}:${bridge.port}/sse` };
      }
    }
  }

  // Passthrough SSE/HTTP servers (shared, no session issues)
  for (const [name, config] of Object.entries(servers)) {
    if (isSseServer(config)) {
      const rewritten = config.url
        .replace("http://localhost:", `http://${gw}:`)
        .replace("http://127.0.0.1:", `http://${gw}:`);
      urls[name] = { type: "sse", url: rewritten };
    }
  }

  return urls;
}

/**
 * Returns status info for all MCP bridges across all craftsmen.
 */
export function getBridgeStatus(): Array<{
  name: string;
  craftsmanId?: string;
  type: "bridge" | "passthrough";
  status: string;
  port?: number;
  url: string;
  command?: string;
  error?: string;
}> {
  const result = [];
  const gw = getGateway();
  const servers = getHostConfig();

  for (const [craftsmanId, bridgeMap] of craftsmanBridges) {
    for (const [name, bridge] of bridgeMap) {
      result.push({
        name,
        craftsmanId,
        type: "bridge" as const,
        status: bridge.status,
        port: bridge.port,
        url: `http://${gw}:${bridge.port}/sse`,
        command: [bridge.config.command, ...(bridge.config.args ?? [])].join(" "),
        error: bridge.error,
      });
    }
  }

  for (const [name, config] of Object.entries(servers)) {
    if (isSseServer(config)) {
      result.push({
        name,
        type: "passthrough" as const,
        status: "passthrough",
        url: config.url,
      });
    }
  }

  return result;
}

/**
 * Restart bridges for all active craftsmen. Re-reads host config.
 */
export async function restartBridges(): Promise<void> {
  console.log("Restarting all MCP bridges...");
  cachedHostConfig = null; // Force re-read

  // Collect all active craftsman IDs
  const craftsmanIds = [...craftsmanBridges.keys()];

  // Stop all
  for (const id of craftsmanIds) {
    await stopCraftsmanBridges(id);
  }

  // Re-read config
  cachedHostConfig = readHostMcpConfig();

  // Restart for each craftsman
  for (const id of craftsmanIds) {
    await startCraftsmanBridges(id);
  }
}

/** Gracefully stop all bridges. */
export function stopBridges(): void {
  shuttingDown = true;
  for (const [craftsmanId] of craftsmanBridges) {
    const bridgeMap = craftsmanBridges.get(craftsmanId);
    if (bridgeMap) {
      for (const [, bridge] of bridgeMap) {
        bridge.process.kill("SIGTERM");
        releaseBridgePort(bridge.port);
      }
    }
  }
  craftsmanBridges.clear();
}

process.on("SIGTERM", stopBridges);
process.on("SIGINT", stopBridges);
