import Docker from "dockerode";
import fs from "node:fs";
import crypto from "node:crypto";
import db from "../db/client.js";
import type { Craftsman, Project } from "../types.js";

const docker = new Docker();

const CRAFTSMAN_IMAGE = "workshop-craftsman";

const PORT_RANGE_START = 49200;
const PORT_RANGE_END = 49300;

function getUsedPorts(): Set<number> {
  const craftsmen = db
    .prepare("SELECT port_mappings FROM craftsmen WHERE status IN ('pending','starting','running')")
    .all() as { port_mappings: string }[];
  const used = new Set<number>();
  for (const c of craftsmen) {
    const mappings = JSON.parse(c.port_mappings) as Record<string, number>;
    for (const port of Object.values(mappings)) {
      used.add(port);
    }
  }
  return used;
}

function allocatePort(): number {
  const used = getUsedPorts();
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (!used.has(port)) return port;
  }
  throw new Error(`No available ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
}

export async function ensureCraftsmanImage(): Promise<void> {
  const dockerfile = fs.readFileSync("/app/Dockerfile.craftsman", "utf-8");
  const hash = crypto.createHash("sha256").update(dockerfile).digest("hex");

  const images = await docker.listImages({
    filters: { reference: [CRAFTSMAN_IMAGE] },
  });

  if (images.length > 0) {
    const existing = images[0];
    if (existing.Labels?.["dockerfile.hash"] === hash) {
      console.log("Craftsman image up to date.");
      return;
    }
    console.log("Dockerfile.craftsman changed, removing old image...");
    await docker.getImage(existing.Id).remove({ force: true });
  }

  console.log("Building workshop-craftsman image...");
  const stream = await docker.buildImage(
    { context: "/app", src: ["Dockerfile.craftsman"] },
    { t: CRAFTSMAN_IMAGE, dockerfile: "Dockerfile.craftsman", labels: { "dockerfile.hash": hash } }
  );
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err: Error | null) => (err ? reject(err) : resolve()),
      (event: { stream?: string }) => {
        if (event.stream) process.stdout.write(event.stream);
      }
    );
  });
  console.log("Craftsman image built.");
}

export async function createContainer(
  craftsman: Craftsman,
  project: Project
): Promise<{ containerId: string; portMappings: Record<string, number> }> {
  const ports = JSON.parse(project.ports) as number[];
  const exposedPorts: Record<string, object> = {};
  const portBindings: Record<string, Array<{ HostPort: string; HostIp: string }>> = {};

  const portMappings: Record<string, number> = {};
  for (const port of ports) {
    const key = `${port}/tcp`;
    const hostPort = allocatePort();
    exposedPorts[key] = {};
    portBindings[key] = [{ HostIp: "0.0.0.0", HostPort: String(hostPort) }];
    portMappings[String(port)] = hostPort;
  }

  const workspaceDir = `/craftsmen/${craftsman.name}`;
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.chmodSync(workspaceDir, 0o777);

  const container = await docker.createContainer({
    Image: CRAFTSMAN_IMAGE,
    name: `workshop-craftsman-${craftsman.name}`,
    Env: [`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`],
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
      Binds: [`${workspaceDir}:/workspace/project`],
    },
  });

  await container.start();

  return { containerId: container.id, portMappings };
}

const CONTAINER_LOG = "/tmp/workshop.log";

export async function initContainer(
  containerId: string,
  project: Project
): Promise<void> {
  const container = docker.getContainer(containerId);

  // Create log file
  await execInContainer(container, ["touch", CONTAINER_LOG]);

  // Build clone URL, injecting token for private repos
  let cloneUrl = project.repo_url;
  if (project.github_token) {
    const url = new URL(cloneUrl);
    url.username = "x-access-token";
    url.password = project.github_token;
    cloneUrl = url.toString();
  }

  // Clone the repo
  await loggedExec(container, [
    "git",
    "clone",
    "--branch",
    project.branch,
    cloneUrl,
    "/workspace/project",
  ]);

  // Run setup command if specified
  if (project.setup_cmd) {
    await loggedExec(
      container,
      ["sh", "-c", project.setup_cmd],
      "/workspace/project"
    );
  }

  // Start a detached tmux session for interactive terminal access
  await execInContainer(container, ["tmux", "new-session", "-d", "-s", "main", "-c", "/workspace/project"]);
}

/** Run a command and tee its output to the container log file. */
async function loggedExec(
  container: Docker.Container,
  cmd: string[],
  workingDir = "/"
): Promise<string> {
  // Wrap the command so stdout+stderr are appended to the log file
  const escaped = cmd.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const wrapped = `${escaped} 2>&1 | tee -a ${CONTAINER_LOG}`;
  return execInContainer(container, ["sh", "-c", wrapped], workingDir);
}

export async function execInContainer(
  container: Docker.Container,
  cmd: string[],
  workingDir = "/"
): Promise<string> {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: workingDir,
  });

  const stream = await exec.start({ hijack: true, stdin: false });
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      const output = Buffer.concat(chunks).toString("utf8");
      resolve(output);
    });
    stream.on("error", reject);
  });
}

export async function stopContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  try {
    await container.stop();
  } catch (e: any) {
    if (e.statusCode !== 304) throw e; // 304 = already stopped
  }
}

export async function startContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.start();
}

export async function removeContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  try {
    await container.stop();
  } catch {
    // might already be stopped
  }
  await container.remove();
}

export async function getGitDiff(containerId: string): Promise<{ diff: string; stat: string }> {
  const container = docker.getContainer(containerId);
  const [diff, stat] = await Promise.all([
    execInContainer(container, ["git", "diff", "HEAD"], "/workspace/project"),
    execInContainer(container, ["git", "diff", "--stat", "HEAD"], "/workspace/project"),
  ]);
  return { diff, stat };
}

export async function gitCommit(
  containerId: string,
  message: string
): Promise<string> {
  const container = docker.getContainer(containerId);
  await execInContainer(container, ["git", "add", "-A"], "/workspace/project");
  return execInContainer(
    container,
    [
      "git",
      "-c", "user.name=Workshop",
      "-c", "user.email=workshop@local",
      "commit",
      "-m", message,
    ],
    "/workspace/project"
  );
}

export async function gitPush(
  containerId: string,
  branchName: string
): Promise<string> {
  const container = docker.getContainer(containerId);
  return execInContainer(
    container,
    ["git", "push", "origin", `HEAD:${branchName}`, "--force"],
    "/workspace/project"
  );
}

export async function getContainerStats(containerId: string): Promise<{
  cpu_percent: number;
  memory_mb: number;
  memory_limit_mb: number;
  pids: number;
}> {
  const container = docker.getContainer(containerId);
  const stats = (await container.stats({ stream: false })) as any;

  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    (stats.cpu_stats.system_cpu_usage ?? 0) -
    (stats.precpu_stats.system_cpu_usage ?? 0);
  const numCpus =
    stats.cpu_stats.online_cpus ??
    stats.cpu_stats.cpu_usage.percpu_usage?.length ??
    1;
  const cpuPercent =
    systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

  const memoryMb = (stats.memory_stats.usage ?? 0) / 1_048_576;
  const memoryLimitMb = (stats.memory_stats.limit ?? 0) / 1_048_576;

  return {
    cpu_percent: Math.round(cpuPercent * 100) / 100,
    memory_mb: Math.round(memoryMb * 10) / 10,
    memory_limit_mb: Math.round(memoryLimitMb),
    pids: stats.pids_stats?.current ?? 0,
  };
}

export async function getContainerLogs(containerId: string) {
  const container = docker.getContainer(containerId);

  // Ensure the log file exists (may not yet if container just started)
  await execInContainer(container, ["touch", CONTAINER_LOG]);

  const exec = await container.exec({
    Cmd: ["tail", "-n", "100", "-f", CONTAINER_LOG],
    AttachStdout: true,
    AttachStderr: true,
  });

  return exec.start({ hijack: true, stdin: false });
}

export async function reconcileContainers(): Promise<void> {
  const craftsmen = db
    .prepare("SELECT * FROM craftsmen WHERE status = 'running'")
    .all() as Craftsman[];

  for (const c of craftsmen) {
    if (!c.container_id) continue;
    try {
      const container = docker.getContainer(c.container_id);
      const info = await container.inspect();
      if (!info.State.Running) {
        db.prepare(
          "UPDATE craftsmen SET status = 'stopped', updated_at = datetime('now') WHERE id = ?"
        ).run(c.id);
      }
    } catch {
      db.prepare(
        "UPDATE craftsmen SET status = 'stopped', updated_at = datetime('now') WHERE id = ?"
      ).run(c.id);
    }
  }
}

export { docker };
