import Docker from "dockerode";
import db from "../db/client.js";
import type { Craftsman, Project } from "../types.js";

const docker = new Docker();

const CRAFTSMAN_IMAGE = "workshop-craftsman";

export async function ensureCraftsmanImage(): Promise<void> {
  const images = await docker.listImages({
    filters: { reference: [CRAFTSMAN_IMAGE] },
  });
  if (images.length > 0) return;

  console.log("Building workshop-craftsman image...");
  const stream = await docker.buildImage(
    { context: "/app", src: ["Dockerfile.craftsman"] },
    { t: CRAFTSMAN_IMAGE, dockerfile: "Dockerfile.craftsman" }
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
  const portBindings: Record<string, Array<{ HostPort: string }>> = {};

  for (const port of ports) {
    const key = `${port}/tcp`;
    exposedPorts[key] = {};
    portBindings[key] = [{ HostPort: "0" }]; // Let Docker assign a host port
  }

  const container = await docker.createContainer({
    Image: CRAFTSMAN_IMAGE,
    name: `workshop-craftsman-${craftsman.name}`,
    Env: [`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`],
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
    },
  });

  await container.start();

  // Get assigned host ports
  const info = await container.inspect();
  const portMappings: Record<string, number> = {};
  const networkPorts = info.NetworkSettings.Ports;
  for (const port of ports) {
    const key = `${port}/tcp`;
    const binding = networkPorts[key]?.[0];
    if (binding) {
      portMappings[String(port)] = parseInt(binding.HostPort, 10);
    }
  }

  return { containerId: container.id, portMappings };
}

export async function initContainer(
  containerId: string,
  project: Project
): Promise<void> {
  const container = docker.getContainer(containerId);

  // Build clone URL, injecting token for private repos
  let cloneUrl = project.repo_url;
  if (project.github_token) {
    const url = new URL(cloneUrl);
    url.username = "x-access-token";
    url.password = project.github_token;
    cloneUrl = url.toString();
  }

  // Clone the repo
  await execInContainer(container, [
    "git",
    "clone",
    "--branch",
    project.branch,
    cloneUrl,
    "/workspace/project",
  ]);

  // Run setup command if specified
  if (project.setup_cmd) {
    await execInContainer(
      container,
      ["sh", "-c", project.setup_cmd],
      "/workspace/project"
    );
  }
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

export function getContainerLogs(containerId: string) {
  const container = docker.getContainer(containerId);
  return container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail: 100,
  });
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
