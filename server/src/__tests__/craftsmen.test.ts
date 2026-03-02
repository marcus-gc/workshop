import "./setup.js";
import { describe, it, expect, vi } from "vitest";
import { migrate } from "../db/schema.js";
import { request, json, createProject, createCraftsman, createRunningCraftsman, createCraftsmanWithStatus } from "./helpers.js";

migrate();

describe("Craftsmen API", () => {
  describe("POST /api/craftsmen", () => {
    it("creates a craftsman with starting status", async () => {
      const project = await createProject();

      const res = await request("POST", "/api/craftsmen", {
        name: "alice",
        project_id: project.id,
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.name).toBe("alice");
      expect(body.project_id).toBe(project.id);
      expect(body.status).toBe("starting");
      expect(body.id).toBeDefined();
    });

    it("returns 400 when name is missing", async () => {
      const project = await createProject();
      const res = await request("POST", "/api/craftsmen", {
        project_id: project.id,
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when project_id is missing", async () => {
      const res = await request("POST", "/api/craftsmen", {
        name: "alice",
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 when project does not exist", async () => {
      const res = await request("POST", "/api/craftsmen", {
        name: "alice",
        project_id: "00000000-0000-0000-0000-000000000000",
      });
      expect(res.status).toBe(404);
    });

    it("calls createContainer and initContainer", async () => {
      const docker = await import("../services/docker.js");
      const project = await createProject();

      await request("POST", "/api/craftsmen", {
        name: "bob",
        project_id: project.id,
      });

      // Give the async IIFE a tick to run
      await new Promise((r) => setTimeout(r, 50));

      expect(docker.createContainer).toHaveBeenCalled();
      expect(docker.initContainer).toHaveBeenCalledWith(
        "fake-container-id-123",
        expect.objectContaining({ id: project.id })
      );
    });

    it("creates a craftsman with custom ports", async () => {
      const project = await createProject();

      const res = await request("POST", "/api/craftsmen", {
        name: "custom-ports",
        project_id: project.id,
        ports: [8080, 9090],
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.ports).toBe("[8080,9090]");
    });

    it("creates a craftsman without ports (inherits project defaults)", async () => {
      const project = await createProject();

      const res = await request("POST", "/api/craftsmen", {
        name: "default-ports",
        project_id: project.id,
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.ports).toBeNull();
    });

    it("returns 400 for invalid ports", async () => {
      const project = await createProject();

      const res = await request("POST", "/api/craftsmen", {
        name: "bad-ports",
        project_id: project.id,
        ports: "not-an-array",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/craftsmen", () => {
    it("returns empty array when no craftsmen", async () => {
      const res = await request("GET", "/api/craftsmen");
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual([]);
    });

    it("returns all craftsmen", async () => {
      const project = await createProject();
      await createRunningCraftsman(project.id, "alice");
      await createRunningCraftsman(project.id, "bob");

      const res = await request("GET", "/api/craftsmen");
      const body = await json(res);
      expect(body).toHaveLength(2);
    });
  });

  describe("GET /api/craftsmen/:id", () => {
    it("returns a craftsman by id", async () => {
      const project = await createProject();
      const craftsman = (await createRunningCraftsman(project.id)) as any;

      const res = await request("GET", `/api/craftsmen/${craftsman.id}`);
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.id).toBe(craftsman.id);
    });

    it("returns a craftsman by name", async () => {
      const project = await createProject();
      await createRunningCraftsman(project.id, "alice");

      const res = await request("GET", "/api/craftsmen/alice");
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.name).toBe("alice");
    });

    it("returns 404 for nonexistent craftsman", async () => {
      const res = await request("GET", "/api/craftsmen/nobody");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/craftsmen/:id/stop", () => {
    it("stops a running craftsman", async () => {
      const docker = await import("../services/docker.js");
      const project = await createProject();
      const craftsman = (await createRunningCraftsman(project.id, "alice")) as any;

      const res = await request("POST", `/api/craftsmen/alice/stop`);
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.status).toBe("stopped");
      expect(docker.stopContainer).toHaveBeenCalledWith("fake-container-id-123");
    });

    it("returns 404 for nonexistent craftsman", async () => {
      const res = await request("POST", "/api/craftsmen/nobody/stop");
      expect(res.status).toBe(404);
    });

    it("returns 400 when no container", async () => {
      const project = await createProject();
      // Create craftsman without container_id via the API (it starts async)
      const db = (await import("../db/client.js")).default;
      const { v4: uuid } = await import("uuid");
      const id = uuid();
      db.prepare(
        "INSERT INTO craftsmen (id, name, project_id, status) VALUES (?, ?, ?, 'pending')"
      ).run(id, "nocontainer", project.id);

      const res = await request("POST", "/api/craftsmen/nocontainer/stop");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/craftsmen/:id/start", () => {
    it("starts a stopped craftsman", async () => {
      const docker = await import("../services/docker.js");
      const project = await createProject();
      const db = (await import("../db/client.js")).default;

      const craftsman = (await createRunningCraftsman(project.id, "alice")) as any;
      db.prepare("UPDATE craftsmen SET status = 'stopped' WHERE id = ?").run(
        craftsman.id
      );

      const res = await request("POST", "/api/craftsmen/alice/start");
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.status).toBe("running");
      expect(docker.startContainer).toHaveBeenCalledWith("fake-container-id-123");
    });
  });

  describe("PATCH /api/craftsmen/:id", () => {
    it("updates ports on a stopped craftsman", async () => {
      const project = await createProject();
      const craftsman = await createCraftsmanWithStatus(project.id, "stopped-alice", "stopped");

      const res = await request("PATCH", `/api/craftsmen/${craftsman.id}`, {
        ports: [4000, 5000],
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ports).toBe("[4000,5000]");
      expect(body.status).toBe("starting");
    });

    it("rejects update on a running craftsman", async () => {
      const project = await createProject();
      await createRunningCraftsman(project.id, "running-alice");

      const res = await request("PATCH", "/api/craftsmen/running-alice", {
        ports: [4000],
      });
      expect(res.status).toBe(409);
    });

    it("rejects invalid ports (non-array)", async () => {
      const project = await createProject();
      const craftsman = await createCraftsmanWithStatus(project.id, "stopped-bob", "stopped");

      const res = await request("PATCH", `/api/craftsmen/${craftsman.id}`, {
        ports: "not-an-array",
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid ports (out of range)", async () => {
      const project = await createProject();
      const craftsman = await createCraftsmanWithStatus(project.id, "stopped-charlie", "stopped");

      const res = await request("PATCH", `/api/craftsmen/${craftsman.id}`, {
        ports: [0, 70000],
      });
      expect(res.status).toBe(400);
    });

    it("rejects duplicate ports", async () => {
      const project = await createProject();
      const craftsman = await createCraftsmanWithStatus(project.id, "stopped-dave", "stopped");

      const res = await request("PATCH", `/api/craftsmen/${craftsman.id}`, {
        ports: [3000, 3000],
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for nonexistent craftsman", async () => {
      const res = await request("PATCH", "/api/craftsmen/nobody", {
        ports: [3000],
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/craftsmen/:id", () => {
    it("removes a craftsman and its container", async () => {
      const docker = await import("../services/docker.js");
      const project = await createProject();
      const craftsman = (await createRunningCraftsman(project.id, "alice")) as any;

      const res = await request("DELETE", `/api/craftsmen/alice`);
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ ok: true });
      expect(docker.removeContainer).toHaveBeenCalledWith("fake-container-id-123");

      const check = await request("GET", "/api/craftsmen/alice");
      expect(check.status).toBe(404);
    });

    it("returns 404 for nonexistent craftsman", async () => {
      const res = await request("DELETE", "/api/craftsmen/nobody");
      expect(res.status).toBe(404);
    });
  });
});
