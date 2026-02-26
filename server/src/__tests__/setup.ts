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

// Reset DB tables before each test
beforeEach(async () => {
  const { default: db } = await import("../db/client.js");
  db.exec("DELETE FROM craftsmen");
  db.exec("DELETE FROM projects");
});
