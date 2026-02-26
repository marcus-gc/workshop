import { docker } from "./docker.js";
import type Docker from "dockerode";

export async function createTerminalExec(
  containerId: string,
  cols: number,
  rows: number
): Promise<{ stream: NodeJS.ReadWriteStream; exec: Docker.Exec }> {
  const container = docker.getContainer(containerId);

  const exec = await container.exec({
    Cmd: ["/bin/bash"],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    WorkingDir: "/workspace/project",
  });

  const stream = await exec.start({ hijack: true, stdin: true });

  await exec.resize({ h: rows, w: cols });

  return { stream, exec };
}
