import "./setup.js";
import { describe, it, expect, vi } from "vitest";
import { migrate } from "../db/schema.js";
import { request, json, createProject, createRunningCraftsman } from "./helpers.js";

migrate();

describe("Messages API", () => {
  describe("POST /api/craftsmen/:id/messages", () => {
    it("sends a message and returns the assistant response", async () => {
      const project = await createProject();
      await createRunningCraftsman(project.id, "alice");

      const res = await request("POST", "/api/craftsmen/alice/messages", {
        content: "Add a login page",
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.role).toBe("assistant");
      expect(body.content).toBe("I'll help you with that.");
      expect(body.cost_usd).toBe(0.025);
      expect(body.duration_ms).toBe(5000);
      expect(body.craftsman_id).toBeDefined();
    });

    it("saves both user and assistant messages", async () => {
      const project = await createProject();
      await createRunningCraftsman(project.id, "alice");

      await request("POST", "/api/craftsmen/alice/messages", {
        content: "Add a login page",
      });

      const history = await request("GET", "/api/craftsmen/alice/messages");
      const messages = await json(history);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Add a login page");
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].content).toBe("I'll help you with that.");
    });

    it("updates craftsman session_id after first message", async () => {
      const project = await createProject();
      await createRunningCraftsman(project.id, "alice");

      await request("POST", "/api/craftsmen/alice/messages", {
        content: "hello",
      });

      const res = await request("GET", "/api/craftsmen/alice");
      const craftsman = await json(res);
      expect(craftsman.session_id).toBe("fake-session-123");
    });

    it("passes session_id on subsequent messages", async () => {
      const claude = await import("../services/claude.js");
      const project = await createProject();
      await createRunningCraftsman(project.id, "alice");

      // First message — no session yet
      await request("POST", "/api/craftsmen/alice/messages", {
        content: "first",
      });

      // Second message — should pass session_id
      await request("POST", "/api/craftsmen/alice/messages", {
        content: "second",
      });

      expect(claude.sendMessage).toHaveBeenLastCalledWith(
        "fake-container-id-123",
        "second",
        "fake-session-123"
      );
    });

    it("returns 404 for nonexistent craftsman", async () => {
      const res = await request("POST", "/api/craftsmen/nobody/messages", {
        content: "hello",
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when craftsman is not running", async () => {
      const project = await createProject();
      const db = (await import("../db/client.js")).default;
      const { v4: uuid } = await import("uuid");
      const id = uuid();
      db.prepare(
        "INSERT INTO craftsmen (id, name, project_id, status) VALUES (?, ?, ?, 'stopped')"
      ).run(id, "stopped-guy", project.id);

      const res = await request("POST", "/api/craftsmen/stopped-guy/messages", {
        content: "hello",
      });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/stopped/);
    });

    it("returns 400 when content is missing", async () => {
      const project = await createProject();
      await createRunningCraftsman(project.id, "alice");

      const res = await request("POST", "/api/craftsmen/alice/messages", {});
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/content/i);
    });
  });

  describe("GET /api/craftsmen/:id/messages", () => {
    it("returns empty array when no messages", async () => {
      const project = await createProject();
      await createRunningCraftsman(project.id, "alice");

      const res = await request("GET", "/api/craftsmen/alice/messages");
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual([]);
    });

    it("returns messages in chronological order", async () => {
      const project = await createProject();
      await createRunningCraftsman(project.id, "alice");

      await request("POST", "/api/craftsmen/alice/messages", {
        content: "first",
      });
      await request("POST", "/api/craftsmen/alice/messages", {
        content: "second",
      });

      const res = await request("GET", "/api/craftsmen/alice/messages");
      const messages = await json(res);
      expect(messages).toHaveLength(4); // 2 user + 2 assistant
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("first");
      expect(messages[1].role).toBe("assistant");
      expect(messages[2].role).toBe("user");
      expect(messages[2].content).toBe("second");
      expect(messages[3].role).toBe("assistant");
    });

    it("returns 404 for nonexistent craftsman", async () => {
      const res = await request("GET", "/api/craftsmen/nobody/messages");
      expect(res.status).toBe(404);
    });

    it("only returns messages for the requested craftsman", async () => {
      const project = await createProject();
      await createRunningCraftsman(project.id, "alice");
      await createRunningCraftsman(project.id, "bob");

      await request("POST", "/api/craftsmen/alice/messages", {
        content: "for alice",
      });
      await request("POST", "/api/craftsmen/bob/messages", {
        content: "for bob",
      });

      const aliceRes = await request("GET", "/api/craftsmen/alice/messages");
      const aliceMessages = await json(aliceRes);
      expect(aliceMessages).toHaveLength(2);
      expect(aliceMessages[0].content).toBe("for alice");

      const bobRes = await request("GET", "/api/craftsmen/bob/messages");
      const bobMessages = await json(bobRes);
      expect(bobMessages).toHaveLength(2);
      expect(bobMessages[0].content).toBe("for bob");
    });
  });
});
