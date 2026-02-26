import { docker } from "./docker.js";
import type { ClaudeResponse, StreamEvent } from "../types.js";

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

export async function streamMessage(
  containerId: string,
  message: string,
  sessionId: string | null,
  onEvent: (event: StreamEvent) => void
): Promise<ClaudeResponse> {
  const container = docker.getContainer(containerId);

  const cmd = [
    "claude",
    "-p",
    message,
    "--output-format",
    "stream-json",
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

  const execStream = await exec.start({ hijack: true, stdin: false });

  return new Promise<ClaudeResponse>((resolve, reject) => {
    let rawBuffer = Buffer.alloc(0);
    let lineBuffer = "";
    let result: ClaudeResponse | null = null;

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed) as StreamEvent;
        if (event.type === "result") {
          result = {
            result: (event as any).result ?? "",
            session_id: (event as any).session_id ?? "",
            cost_usd: (event as any).total_cost_usd ?? 0,
            duration_ms: (event as any).duration_ms ?? 0,
          };
        }
        onEvent(event);
      } catch {
        // Non-JSON line, skip
      }
    };

    execStream.on("data", (chunk: Buffer) => {
      rawBuffer = Buffer.concat([rawBuffer, chunk]);
      // Extract complete Docker multiplexed frames
      while (rawBuffer.length >= 8) {
        const frameSize = rawBuffer.readUInt32BE(4);
        if (rawBuffer.length < 8 + frameSize) break;
        const payload = rawBuffer.subarray(8, 8 + frameSize).toString("utf8");
        rawBuffer = rawBuffer.subarray(8 + frameSize);
        lineBuffer += payload;
        const parts = lineBuffer.split("\n");
        lineBuffer = parts.pop() ?? "";
        for (const part of parts) {
          processLine(part);
        }
      }
    });

    execStream.on("end", () => {
      if (lineBuffer.trim()) processLine(lineBuffer);
      if (result) {
        resolve(result);
      } else {
        reject(new Error("Claude stream ended without a result"));
      }
    });

    execStream.on("error", reject);
  });
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
