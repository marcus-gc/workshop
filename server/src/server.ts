import { Hono } from "hono";
import { logger } from "hono/logger";
import projects from "./routes/projects.js";
import craftsmen from "./routes/craftsmen.js";
import stream from "./routes/stream.js";
import messages from "./routes/messages.js";
import logs from "./routes/logs.js";
import events from "./routes/events.js";
import git from "./routes/git.js";
import stats from "./routes/stats.js";

const app = new Hono();

app.use(logger());

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.route("/api/projects", projects);
app.route("/api/craftsmen", craftsmen);
// stream must be mounted before messages so /:id/messages/stream
// is matched before /:id/messages
app.route("/api/craftsmen", stream);
app.route("/api/craftsmen", messages);
app.route("/api/craftsmen", logs);
app.route("/api/craftsmen", events);
app.route("/api/craftsmen", git);
app.route("/api/craftsmen", stats);

export default app;
