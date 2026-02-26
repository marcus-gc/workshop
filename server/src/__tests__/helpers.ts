import app from "../server.js";

type Method = "GET" | "POST" | "DELETE" | "PUT" | "PATCH";

export async function request(method: Method, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await app.request(path, init);
  return res;
}

export async function json(res: Response) {
  return res.json();
}

export async function createProject(overrides: Record<string, unknown> = {}) {
  const res = await request("POST", "/api/projects", {
    name: "test-project",
    repo_url: "https://github.com/test/repo",
    branch: "main",
    ports: [3000],
    ...overrides,
  });
  return json(res);
}

export async function createCraftsman(
  projectId: string,
  overrides: Record<string, unknown> = {}
) {
  const res = await request("POST", "/api/craftsmen", {
    name: "test-craftsman",
    project_id: projectId,
    ...overrides,
  });
  return json(res);
}

export interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Read SSE events from a Response body stream.
 *
 * @param res       - The Response with a text/event-stream body.
 * @param count     - Stop (and cancel the reader) after collecting this many events.
 *                    If omitted, read until the stream closes naturally.
 * @param timeoutMs - Per-read deadline. Returns collected events if a read stalls
 *                    longer than this (useful for streams that don't close naturally).
 */
export async function readSSEEvents(
  res: Response,
  { count, timeoutMs = 500 }: { count?: number; timeoutMs?: number } = {}
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const timedRead = () =>
    Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`SSE read timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);

  try {
    while (true) {
      const { done, value } = await timedRead();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are delimited by blank lines (\n\n)
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let eventName = "message";
        let data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event: ")) eventName = line.slice(7);
          else if (line.startsWith("data: ")) data = line.slice(6);
        }
        events.push({ event: eventName, data });

        if (count !== undefined && events.length >= count) {
          await reader.cancel();
          return events;
        }
      }
    }
  } catch {
    // Timeout or aborted — return whatever was collected
  }

  return events;
}

/**
 * Insert a craftsman directly into the DB with a given status and a fake container_id.
 */
export async function createCraftsmanWithStatus(
  projectId: string,
  name: string,
  status: string
) {
  const { default: db } = await import("../db/client.js");
  const { v4: uuid } = await import("uuid");
  const id = uuid();
  db.prepare(
    `INSERT INTO craftsmen (id, name, project_id, container_id, status, port_mappings)
     VALUES (?, ?, ?, 'fake-container-id-123', ?, '{"3000":49200}')`
  ).run(id, name, projectId, status);
  return db.prepare("SELECT * FROM craftsmen WHERE id = ?").get(id) as any;
}

/**
 * Insert a craftsman directly into the DB with status "running" and a fake container_id.
 * Bypasses the async container startup for tests that need a running craftsman.
 */
export async function createRunningCraftsman(projectId: string, name = "test-craftsman") {
  const { default: db } = await import("../db/client.js");
  const { v4: uuid } = await import("uuid");
  const id = uuid();
  db.prepare(
    `INSERT INTO craftsmen (id, name, project_id, container_id, status, port_mappings)
     VALUES (?, ?, ?, 'fake-container-id-123', 'running', '{"3000":49200}')`
  ).run(id, name, projectId);
  return db.prepare("SELECT * FROM craftsmen WHERE id = ?").get(id);
}
