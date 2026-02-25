import { Hono } from "hono";
import { logger } from "hono/logger";
import projects from "./routes/projects.js";
import craftsmen from "./routes/craftsmen.js";
import messages from "./routes/messages.js";
import logs from "./routes/logs.js";

const app = new Hono();

app.use(logger());

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.route("/api/projects", projects);
app.route("/api/craftsmen", craftsmen);
app.route("/api/craftsmen", messages);
app.route("/api/craftsmen", logs);

export default app;
