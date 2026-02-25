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
