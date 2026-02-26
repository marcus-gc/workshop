import "./setup.js";
import { describe, it, expect, vi } from "vitest";
import { migrate } from "../db/schema.js";
import { request, createProject, createRunningCraftsman, readSSEEvents } from "./helpers.js";

migrate();

describe("POST /api/craftsmen/:id/messages/stream", () => {
  it("returns 404 for nonexistent craftsman", async () => {
    const res = await request("POST", "/api/craftsmen/nobody/messages/stream", {
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
    ).run(id, "stopped-agent", project.id);

    const res = await request("POST", "/api/craftsmen/stopped-agent/messages/stream", {
      content: "hello",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/stopped/);
  });

  it("returns 400 when content is missing", async () => {
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("POST", "/api/craftsmen/alice/messages/stream", {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/content/i);
  });

  it("returns 200 with text/event-stream content type", async () => {
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "list the files",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
  });

  it("streams events from streamMessage as SSE before done", async () => {
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "list the files",
    });

    const events = await readSSEEvents(res);

    // Should include the events the mock calls onEvent with
    const types = events.map((e) => e.event);
    expect(types).toContain("system");
    expect(types).toContain("assistant");
    expect(types).toContain("result");
  });

  it("sends a done event as the final event", async () => {
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "list the files",
    });

    const events = await readSSEEvents(res);

    const lastEvent = events[events.length - 1];
    expect(lastEvent.event).toBe("done");
  });

  it("done event includes result, session_id, cost_usd, duration_ms, and message_id", async () => {
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "list the files",
    });

    const events = await readSSEEvents(res);
    const done = events.find((e) => e.event === "done")!;
    const data = JSON.parse(done.data);

    expect(data.result).toBe("Done.");
    expect(data.session_id).toBe("stream-session-456");
    expect(data.cost_usd).toBe(0.01);
    expect(data.duration_ms).toBe(3000);
    expect(data.message_id).toBeDefined();
  });

  it("saves the user message to the DB before streaming begins", async () => {
    const claude = await import("../services/claude.js");
    // Capture the craftsman ID so we can inspect DB state from inside the mock
    let capturedCraftsmanId: string | undefined;

    vi.mocked(claude.streamMessage).mockImplementationOnce(
      async (_containerId, _message, _sessionId, onEvent) => {
        const db = (await import("../db/client.js")).default;
        // The user message should already be in the DB when streaming starts
        const msgs = db
          .prepare("SELECT * FROM messages ORDER BY created_at ASC")
          .all() as any[];
        capturedCraftsmanId = msgs[0]?.craftsman_id;
        expect(msgs).toHaveLength(1);
        expect(msgs[0].role).toBe("user");
        expect(msgs[0].content).toBe("list the files");

        onEvent({ type: "result", result: "Done.", session_id: "s1", total_cost_usd: 0, duration_ms: 100 });
        return { result: "Done.", session_id: "s1", cost_usd: 0, duration_ms: 100 };
      }
    );

    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "list the files",
    });

    await readSSEEvents(res);
    expect(capturedCraftsmanId).toBeDefined();
  });

  it("saves the assistant message after the done event", async () => {
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "list the files",
    });

    await readSSEEvents(res);

    const db = (await import("../db/client.js")).default;
    const messages = db
      .prepare("SELECT * FROM messages ORDER BY created_at ASC")
      .all() as any[];

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("list the files");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Done.");
    expect(messages[1].cost_usd).toBe(0.01);
    expect(messages[1].duration_ms).toBe(3000);
  });

  it("updates the craftsman session_id after done", async () => {
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "first message",
    });

    await readSSEEvents(res);

    const craftsmanRes = await request("GET", "/api/craftsmen/alice");
    const craftsman = await craftsmanRes.json();
    expect(craftsman.session_id).toBe("stream-session-456");
  });

  it("passes session_id to streamMessage on subsequent calls", async () => {
    const claude = await import("../services/claude.js");
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    // First message — establishes session
    const res1 = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "first",
    });
    await readSSEEvents(res1);

    // Second message — should use the session from the first
    const res2 = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "second",
    });
    await readSSEEvents(res2);

    expect(vi.mocked(claude.streamMessage)).toHaveBeenLastCalledWith(
      "fake-container-id-123",
      "second",
      "stream-session-456",
      expect.any(Function)
    );
  });

  it("sends an error event when streamMessage rejects", async () => {
    const claude = await import("../services/claude.js");
    vi.mocked(claude.streamMessage).mockRejectedValueOnce(
      new Error("container exec failed")
    );

    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "do something",
    });

    const events = await readSSEEvents(res);

    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect(JSON.parse(errorEvent!.data).error).toMatch(/container exec failed/);
  });

  it("does not save an assistant message when streamMessage rejects", async () => {
    const claude = await import("../services/claude.js");
    vi.mocked(claude.streamMessage).mockRejectedValueOnce(new Error("boom"));

    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "do something",
    });
    await readSSEEvents(res);

    const db = (await import("../db/client.js")).default;
    const messages = db.prepare("SELECT * FROM messages").all() as any[];

    // Only the user message should exist; no assistant message on failure
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("each SSE event carries the raw event type from the stream", async () => {
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("POST", "/api/craftsmen/alice/messages/stream", {
      content: "go",
    });

    const events = await readSSEEvents(res);

    // The mock emits type=system, type=assistant, type=result — verify those come through
    // followed by the server-added done event
    const eventNames = events.map((e) => e.event);
    expect(eventNames).toEqual(["system", "assistant", "result", "done"]);
  });
});
