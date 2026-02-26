import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import projects from "./routes/projects.js";
import craftsmen from "./routes/craftsmen.js";
import logs from "./routes/logs.js";
import events from "./routes/events.js";
import git from "./routes/git.js";
import stats from "./routes/stats.js";

const app = new Hono();

app.use(logger());

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.route("/api/projects", projects);
app.route("/api/craftsmen", craftsmen);
app.route("/api/craftsmen", logs);
app.route("/api/craftsmen", events);
app.route("/api/craftsmen", git);
app.route("/api/craftsmen", stats);

// Serve built React app from ./public (relative to CWD = /app in Docker)
app.use("/*", serveStatic({ root: "./public" }));

// SPA fallback: return index.html for any path not matched above
app.get("*", (c) => {
  const indexPath = join(process.cwd(), "public", "index.html");
  if (!existsSync(indexPath)) {
    return c.text("Workshop API is running. Build the frontend to serve the UI.", 200);
  }
  const html = readFileSync(indexPath, "utf-8");
  return c.html(html);
});

export default app;
