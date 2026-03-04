import net from "node:net";
import Docker from "dockerode";
import db from "../db/client.js";

const docker = new Docker();

interface ActiveProxy {
  server: net.Server;
  hostPort: number;
  containerPort: number;
  containerIp: string;
}

// Keyed by "craftsmanId:containerPort"
const activeProxies = new Map<string, ActiveProxy>();

function proxyKey(craftsmanId: string, containerPort: number): string {
  return `${craftsmanId}:${containerPort}`;
}

export async function addPortProxy(
  craftsmanId: string,
  containerId: string,
  containerPort: number
): Promise<{ hostPort: number; containerPort: number }> {
  const key = proxyKey(craftsmanId, containerPort);
  if (activeProxies.has(key)) {
    const existing = activeProxies.get(key)!;
    return { hostPort: existing.hostPort, containerPort };
  }

  // Resolve container IP
  const info = await docker.getContainer(containerId).inspect();
  const networks = info.NetworkSettings.Networks;
  const networkName = Object.keys(networks)[0];
  const containerIp = networks[networkName]?.IPAddress;
  if (!containerIp) {
    throw new Error("Could not resolve container IP address");
  }

  // Import allocatePort dynamically to avoid circular dependency at module load
  const { allocatePort } = await import("./docker.js");
  const hostPort = allocatePort();

  // Create TCP proxy server
  const server = net.createServer((clientSocket) => {
    const targetSocket = net.connect(containerPort, containerIp, () => {
      clientSocket.pipe(targetSocket);
      targetSocket.pipe(clientSocket);
    });

    clientSocket.on("error", () => targetSocket.destroy());
    targetSocket.on("error", () => clientSocket.destroy());
    clientSocket.on("close", () => targetSocket.destroy());
    targetSocket.on("close", () => clientSocket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(hostPort, "0.0.0.0", () => resolve());
    server.on("error", reject);
  });

  activeProxies.set(key, { server, hostPort, containerPort, containerIp });

  // Update DB: add to port_mappings and dynamic_ports
  const craftsman = db
    .prepare("SELECT port_mappings, dynamic_ports FROM craftsmen WHERE id = ?")
    .get(craftsmanId) as { port_mappings: string; dynamic_ports: string } | undefined;

  if (craftsman) {
    const mappings = JSON.parse(craftsman.port_mappings) as Record<string, number>;
    mappings[String(containerPort)] = hostPort;

    const dynPorts = JSON.parse(craftsman.dynamic_ports || "[]") as number[];
    if (!dynPorts.includes(containerPort)) {
      dynPorts.push(containerPort);
    }

    db.prepare(
      "UPDATE craftsmen SET port_mappings = ?, dynamic_ports = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(mappings), JSON.stringify(dynPorts), craftsmanId);
  }

  console.log(`Proxy: ${hostPort} -> ${containerIp}:${containerPort} (craftsman ${craftsmanId})`);
  return { hostPort, containerPort };
}

export function removePortProxy(craftsmanId: string, containerPort: number): void {
  const key = proxyKey(craftsmanId, containerPort);
  const proxy = activeProxies.get(key);
  if (!proxy) return;

  proxy.server.close();
  activeProxies.delete(key);

  // Update DB: remove from port_mappings and dynamic_ports
  const craftsman = db
    .prepare("SELECT port_mappings, dynamic_ports FROM craftsmen WHERE id = ?")
    .get(craftsmanId) as { port_mappings: string; dynamic_ports: string } | undefined;

  if (craftsman) {
    const mappings = JSON.parse(craftsman.port_mappings) as Record<string, number>;
    delete mappings[String(containerPort)];

    const dynPorts = (JSON.parse(craftsman.dynamic_ports || "[]") as number[]).filter(
      (p) => p !== containerPort
    );

    db.prepare(
      "UPDATE craftsmen SET port_mappings = ?, dynamic_ports = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(mappings), JSON.stringify(dynPorts), craftsmanId);
  }

  console.log(`Proxy removed: container port ${containerPort} (craftsman ${craftsmanId})`);
}

export function removeAllProxies(craftsmanId: string): void {
  for (const [key, proxy] of activeProxies) {
    if (key.startsWith(`${craftsmanId}:`)) {
      proxy.server.close();
      activeProxies.delete(key);
    }
  }

  // Clear dynamic_ports in DB but keep static port_mappings intact
  const craftsman = db
    .prepare("SELECT port_mappings, dynamic_ports FROM craftsmen WHERE id = ?")
    .get(craftsmanId) as { port_mappings: string; dynamic_ports: string } | undefined;

  if (craftsman) {
    const mappings = JSON.parse(craftsman.port_mappings) as Record<string, number>;
    const dynPorts = JSON.parse(craftsman.dynamic_ports || "[]") as number[];

    // Remove dynamic port entries from mappings
    for (const port of dynPorts) {
      delete mappings[String(port)];
    }

    db.prepare(
      "UPDATE craftsmen SET port_mappings = ?, dynamic_ports = '[]', updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(mappings), craftsmanId);
  }
}

export async function restoreProxies(
  craftsmanId: string,
  containerId: string
): Promise<void> {
  const craftsman = db
    .prepare("SELECT dynamic_ports FROM craftsmen WHERE id = ?")
    .get(craftsmanId) as { dynamic_ports: string } | undefined;

  if (!craftsman) return;

  const dynPorts = JSON.parse(craftsman.dynamic_ports || "[]") as number[];
  if (dynPorts.length === 0) return;

  // Clear dynamic_ports first so addPortProxy can re-add them cleanly
  db.prepare(
    "UPDATE craftsmen SET dynamic_ports = '[]', updated_at = datetime('now') WHERE id = ?"
  ).run(craftsmanId);

  // Also remove the dynamic port entries from port_mappings
  const row = db
    .prepare("SELECT port_mappings FROM craftsmen WHERE id = ?")
    .get(craftsmanId) as { port_mappings: string };
  const mappings = JSON.parse(row.port_mappings) as Record<string, number>;
  for (const port of dynPorts) {
    delete mappings[String(port)];
  }
  db.prepare(
    "UPDATE craftsmen SET port_mappings = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(mappings), craftsmanId);

  for (const port of dynPorts) {
    try {
      await addPortProxy(craftsmanId, containerId, port);
    } catch (err) {
      console.error(`Failed to restore proxy for port ${port} (craftsman ${craftsmanId}):`, err);
    }
  }
}

export function getProxiedPorts(): Set<number> {
  const ports = new Set<number>();
  for (const proxy of activeProxies.values()) {
    ports.add(proxy.hostPort);
  }
  return ports;
}

export function shutdownAllProxies(): void {
  for (const [key, proxy] of activeProxies) {
    proxy.server.close();
    activeProxies.delete(key);
  }
}
