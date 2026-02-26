import { vi, beforeEach } from "vitest";

// Mock Docker services — no Docker daemon in tests
vi.mock("../services/docker.js", () => ({
  ensureCraftsmanImage: vi.fn().mockResolvedValue(undefined),
  reconcileContainers: vi.fn().mockResolvedValue(undefined),
  createContainer: vi.fn().mockResolvedValue({
    containerId: "fake-container-id-123",
    portMappings: { "3000": 49200 },
  }),
  initContainer: vi.fn().mockResolvedValue(undefined),
  stopContainer: vi.fn().mockResolvedValue(undefined),
  startContainer: vi.fn().mockResolvedValue(undefined),
  removeContainer: vi.fn().mockResolvedValue(undefined),
  getContainerLogs: vi.fn(),
  getGitDiff: vi.fn().mockResolvedValue({ diff: "diff --git a/file.ts", stat: " file.ts | 5 +++++" }),
  gitCommit: vi.fn().mockResolvedValue("[main abc1234] test commit\n 1 file changed"),
  gitPush: vi.fn().mockResolvedValue("To https://github.com/owner/repo\n * [new branch] craftsman/alice"),
  getContainerStats: vi.fn().mockResolvedValue({
    cpu_percent: 5.2,
    memory_mb: 128.4,
    memory_limit_mb: 2048,
    pids: 12,
  }),
  docker: {},
}));

vi.mock("../services/claude.js", () => ({
  sendMessage: vi.fn().mockResolvedValue({
    result: "I'll help you with that.",
    session_id: "fake-session-123",
    cost_usd: 0.025,
    duration_ms: 5000,
  }),
  streamMessage: vi.fn().mockImplementation(
    (_containerId: string, _message: string, _sessionId: string | null, onEvent: (e: unknown) => void) => {
      onEvent({ type: "system", subtype: "init", session_id: "stream-session-456" });
      onEvent({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Working on it..." }] } });
      onEvent({ type: "result", result: "Done.", session_id: "stream-session-456", total_cost_usd: 0.01, duration_ms: 3000 });
      return Promise.resolve({
        result: "Done.",
        session_id: "stream-session-456",
        cost_usd: 0.01,
        duration_ms: 3000,
      });
    }
  ),
}));

// Reset DB tables before each test
beforeEach(async () => {
  const { default: db } = await import("../db/client.js");
  db.exec("DELETE FROM messages");
  db.exec("DELETE FROM craftsmen");
  db.exec("DELETE FROM projects");
});
