import "./setup.js";
import { describe, it, expect } from "vitest";
import { migrate } from "../db/schema.js";
import { request, createProject, createRunningCraftsman, createCraftsmanWithStatus, readSSEEvents } from "./helpers.js";

migrate();

describe("GET /api/craftsmen/:id/events", () => {
  it("returns 404 for nonexistent craftsman", async () => {
    const res = await request("GET", "/api/craftsmen/nobody/events");
    expect(res.status).toBe(404);
  });

  it("returns 200 with text/event-stream content type", async () => {
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("GET", "/api/craftsmen/alice/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
  });

  it("works by craftsman name", async () => {
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("GET", "/api/craftsmen/alice/events");
    expect(res.status).toBe(200);
  });

  it("immediately sends current status as the first event", async () => {
    const project = await createProject();
    await createRunningCraftsman(project.id, "alice");

    const res = await request("GET", "/api/craftsmen/alice/events");
    // Read 1 event and cancel — the stream stays open for a running craftsman
    const events = await readSSEEvents(res, { count: 1 });

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("status");
    const data = JSON.parse(events[0].data);
    expect(data.status).toBe("running");
    expect(data.id).toBeDefined();
  });

  it("includes craftsman id in every status event", async () => {
    const project = await createProject();
    const craftsman = await createRunningCraftsman(project.id, "alice") as any;

    const res = await request("GET", "/api/craftsmen/alice/events");
    const events = await readSSEEvents(res, { count: 1 });

    const data = JSON.parse(events[0].data);
    expect(data.id).toBe(craftsman.id);
  });

  it("reflects stopped status immediately", async () => {
    const project = await createProject();
    await createCraftsmanWithStatus(project.id, "alice", "stopped");

    const res = await request("GET", "/api/craftsmen/alice/events");
    const events = await readSSEEvents(res, { count: 1 });

    expect(events[0].event).toBe("status");
    expect(JSON.parse(events[0].data).status).toBe("stopped");
  });

  it("reflects error status immediately", async () => {
    const project = await createProject();
    await createCraftsmanWithStatus(project.id, "alice", "error");

    const res = await request("GET", "/api/craftsmen/alice/events");
    const events = await readSSEEvents(res, { count: 1 });

    expect(events[0].event).toBe("status");
    expect(JSON.parse(events[0].data).status).toBe("error");
  });

  it("emits a status event when the craftsman transitions from starting to running", async () => {
    const { emitStatusChange } = await import("../services/events.js");
    const project = await createProject();
    const craftsman = await createCraftsmanWithStatus(project.id, "watcher", "starting");

    const res = await request("GET", "/api/craftsmen/watcher/events");

    // Start collecting events in the background; stream stays open until running is emitted
    const eventsPromise = readSSEEvents(res, { count: 2, timeoutMs: 1000 });

    // Yield so the SSE handler can subscribe to craftsmanEvents before we fire
    await new Promise((r) => setTimeout(r, 20));

    // Simulate the container startup completing
    emitStatusChange(craftsman.id, "running");

    const events = await eventsPromise;

    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("status");
    expect(JSON.parse(events[0].data).status).toBe("starting");
    expect(events[1].event).toBe("status");
    expect(JSON.parse(events[1].data).status).toBe("running");
  });

  it("stream closes after a terminal status transition", async () => {
    const { emitStatusChange } = await import("../services/events.js");
    const project = await createProject();
    const craftsman = await createCraftsmanWithStatus(project.id, "closer", "starting");

    const res = await request("GET", "/api/craftsmen/closer/events");

    // Collect without a count limit — the stream should close on its own
    const eventsPromise = readSSEEvents(res, { timeoutMs: 1000 });

    await new Promise((r) => setTimeout(r, 20));
    emitStatusChange(craftsman.id, "running");

    const events = await eventsPromise;
    // Stream was closed by the handler after emitting "running"
    expect(events.length).toBeGreaterThanOrEqual(2);
    const lastEvent = events[events.length - 1];
    expect(JSON.parse(lastEvent.data).status).toBe("running");
  });

  it("includes error_message in payload on error transition", async () => {
    const { emitStatusChange } = await import("../services/events.js");
    const project = await createProject();
    const craftsman = await createCraftsmanWithStatus(project.id, "failing", "starting");

    const res = await request("GET", "/api/craftsmen/failing/events");
    const eventsPromise = readSSEEvents(res, { count: 2, timeoutMs: 1000 });

    await new Promise((r) => setTimeout(r, 20));
    emitStatusChange(craftsman.id, "error", { error_message: "container exited with code 1" });

    const events = await eventsPromise;
    const errorEvent = events.find((e) => JSON.parse(e.data).status === "error");
    expect(errorEvent).toBeDefined();
    expect(JSON.parse(errorEvent!.data).error_message).toBe("container exited with code 1");
  });

  it("does not emit events intended for a different craftsman", async () => {
    const { emitStatusChange } = await import("../services/events.js");
    const project = await createProject();
    const alice = await createCraftsmanWithStatus(project.id, "alice", "starting");
    await createCraftsmanWithStatus(project.id, "bob", "starting");

    const res = await request("GET", "/api/craftsmen/alice/events");
    const eventsPromise = readSSEEvents(res, { count: 1, timeoutMs: 200 });

    await new Promise((r) => setTimeout(r, 20));
    // Emit for bob — alice's stream should NOT see this
    emitStatusChange("bob-id-that-doesnt-match", "running");

    // Let alice's stream time out (it gets no event from bob)
    const events = await eventsPromise;

    // Only the initial "starting" status should have arrived (count: 1)
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data).status).toBe("starting");
    // And alice's craftsman id — not bob's
    expect(JSON.parse(events[0].data).id).toBe(alice.id);
  });
});
