import { docker } from "./docker.js";
import type { ClaudeResponse } from "../types.js";

export async function sendMessage(
  containerId: string,
  message: string,
  sessionId: string | null
): Promise<ClaudeResponse> {
  const container = docker.getContainer(containerId);

  const cmd = [
    "claude",
    "-p",
    message,
    "--output-format",
    "json",
    "--dangerously-skip-permissions",
  ];

  if (sessionId) {
    cmd.push("--resume", sessionId);
  }

  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: "/workspace/project",
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  const output = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });

  // Docker multiplexed stream has 8-byte headers per frame.
  // Try to parse the raw output first; if that fails, strip headers.
  let jsonStr = output.trim();
  let parsed: any;

  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Strip docker stream headers: each frame has 8-byte header
    const cleaned = stripDockerHeaders(Buffer.from(output));
    jsonStr = cleaned.trim();
    parsed = JSON.parse(jsonStr);
  }

  return {
    result: parsed.result ?? "",
    session_id: parsed.session_id ?? "",
    cost_usd: parsed.total_cost_usd ?? 0,
    duration_ms: parsed.duration_ms ?? 0,
  };
}

function stripDockerHeaders(buf: Buffer): string {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    if (offset + 8 + size > buf.length) {
      parts.push(buf.subarray(offset + 8));
      break;
    }
    parts.push(buf.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return Buffer.concat(parts).toString("utf8");
}
