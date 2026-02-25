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
  docker: {},
}));

vi.mock("../services/claude.js", () => ({
  sendMessage: vi.fn().mockResolvedValue({
    result: "I'll help you with that.",
    session_id: "fake-session-123",
    cost_usd: 0.025,
    duration_ms: 5000,
  }),
}));

// Reset DB tables before each test
beforeEach(async () => {
  const { default: db } = await import("../db/client.js");
  db.exec("DELETE FROM messages");
  db.exec("DELETE FROM craftsmen");
  db.exec("DELETE FROM projects");
});
