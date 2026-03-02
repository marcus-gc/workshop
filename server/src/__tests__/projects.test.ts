import "./setup.js";
import { describe, it, expect } from "vitest";
import { migrate } from "../db/schema.js";
import { request, json, createProject } from "./helpers.js";

migrate();

describe("Projects API", () => {
  describe("POST /api/projects", () => {
    it("creates a project with all fields", async () => {
      const res = await request("POST", "/api/projects", {
        name: "my-app",
        repo_url: "https://github.com/user/repo",
        branch: "develop",
        setup_cmd: "npm install",
        ports: [3000, 8080],
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.name).toBe("my-app");
      expect(body.repo_url).toBe("https://github.com/user/repo");
      expect(body.branch).toBe("develop");
      expect(body.setup_cmd).toBe("npm install");
      expect(body.ports).toBe("[3000,8080]");
      expect(body.id).toBeDefined();
      expect(body.created_at).toBeDefined();
    });

    it("applies defaults for optional fields", async () => {
      const res = await request("POST", "/api/projects", {
        name: "minimal",
        repo_url: "https://github.com/user/repo",
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.branch).toBe("main");
      expect(body.setup_cmd).toBeNull();
      expect(body.ports).toBe("[]");
    });

    it("returns 400 when name is missing", async () => {
      const res = await request("POST", "/api/projects", {
        repo_url: "https://github.com/user/repo",
      });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/name.*repo_url.*required/i);
    });

    it("returns 400 when repo_url is missing", async () => {
      const res = await request("POST", "/api/projects", {
        name: "my-app",
      });

      expect(res.status).toBe(400);
    });

    it("redacts github_token from response", async () => {
      const res = await request("POST", "/api/projects", {
        name: "private-app",
        repo_url: "https://github.com/user/repo",
        github_token: "ghp_secret123",
      });

      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.github_token).toBeUndefined();
      expect(body.has_github_token).toBe(true);
    });

    it("sets has_github_token to false when no token", async () => {
      const body = await createProject();
      expect(body.has_github_token).toBe(false);
    });
  });

  describe("GET /api/projects", () => {
    it("returns empty array when no projects", async () => {
      const res = await request("GET", "/api/projects");
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual([]);
    });

    it("returns all projects", async () => {
      await createProject({ name: "project-a" });
      await createProject({ name: "project-b" });

      const res = await request("GET", "/api/projects");
      const body = await json(res);
      expect(body).toHaveLength(2);
    });

    it("redacts github_token from list responses", async () => {
      await createProject({ name: "private", github_token: "ghp_secret" });

      const res = await request("GET", "/api/projects");
      const body = await json(res);
      expect(body[0].github_token).toBeUndefined();
      expect(body[0].has_github_token).toBe(true);
    });
  });

  describe("GET /api/projects/:id", () => {
    it("returns a project by id", async () => {
      const project = await createProject();

      const res = await request("GET", `/api/projects/${project.id}`);
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.id).toBe(project.id);
      expect(body.name).toBe("test-project");
    });

    it("returns 404 for nonexistent id", async () => {
      const res = await request(
        "GET",
        "/api/projects/00000000-0000-0000-0000-000000000000"
      );
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/projects/:id", () => {
    it("updates ports on an existing project", async () => {
      const project = await createProject({ ports: [] });

      const res = await request("PATCH", `/api/projects/${project.id}`, {
        ports: [3000, 8080],
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ports).toBe("[3000,8080]");
      expect(body.id).toBe(project.id);
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await request(
        "PATCH",
        "/api/projects/00000000-0000-0000-0000-000000000000",
        { ports: [3000] }
      );
      expect(res.status).toBe(404);
    });

    it("returns 400 when ports is not an array", async () => {
      const project = await createProject();

      const res = await request("PATCH", `/api/projects/${project.id}`, {
        ports: "3000",
      });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/array/i);
    });

    it("returns 400 for invalid port numbers", async () => {
      const project = await createProject();

      const res = await request("PATCH", `/api/projects/${project.id}`, {
        ports: [0],
      });
      expect(res.status).toBe(400);

      const res2 = await request("PATCH", `/api/projects/${project.id}`, {
        ports: [70000],
      });
      expect(res2.status).toBe(400);

      const res3 = await request("PATCH", `/api/projects/${project.id}`, {
        ports: [3.5],
      });
      expect(res3.status).toBe(400);
    });

    it("returns 400 for duplicate ports", async () => {
      const project = await createProject();

      const res = await request("PATCH", `/api/projects/${project.id}`, {
        ports: [3000, 3000],
      });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/duplicate/i);
    });

    it("allows setting ports to empty array", async () => {
      const project = await createProject({ ports: [3000] });

      const res = await request("PATCH", `/api/projects/${project.id}`, {
        ports: [],
      });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ports).toBe("[]");
    });

    it("redacts github_token from response", async () => {
      const project = await createProject({ github_token: "ghp_secret" });

      const res = await request("PATCH", `/api/projects/${project.id}`, {
        ports: [4000],
      });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.github_token).toBeUndefined();
      expect(body.has_github_token).toBe(true);
    });
  });

  describe("DELETE /api/projects/:id", () => {
    it("deletes a project", async () => {
      const project = await createProject();

      const res = await request("DELETE", `/api/projects/${project.id}`);
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ ok: true });

      const check = await request("GET", `/api/projects/${project.id}`);
      expect(check.status).toBe(404);
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await request(
        "DELETE",
        "/api/projects/00000000-0000-0000-0000-000000000000"
      );
      expect(res.status).toBe(404);
    });

    it("returns 409 when craftsmen exist", async () => {
      const project = await createProject();
      const { createRunningCraftsman } = await import("./helpers.js");
      await createRunningCraftsman(project.id);

      const res = await request("DELETE", `/api/projects/${project.id}`);
      expect(res.status).toBe(409);
      const body = await json(res);
      expect(body.error).toMatch(/craftsmen/i);
    });
  });
});
