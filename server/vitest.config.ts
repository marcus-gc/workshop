import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      WORKSHOP_DB_PATH: ":memory:",
    },
  },
});
