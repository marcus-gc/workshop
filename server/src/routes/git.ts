import { Hono } from "hono";
import db from "../db/client.js";
import type { Project } from "../types.js";
import { getGitDiff, gitCommit, gitPush } from "../services/docker.js";
import { findCraftsman } from "./craftsmen.js";

const app = new Hono();

app.get("/:id/diff", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);
  if (!craftsman.container_id) return c.json({ error: "No container" }, 400);

  const { diff, stat } = await getGitDiff(craftsman.container_id);

  // Parse --stat output for summary numbers
  // Format: " N files changed, N insertions(+), N deletions(-)"
  const filesChanged: string[] = [];
  let insertions = 0;
  let deletions = 0;

  for (const line of stat.split("\n")) {
    const fileMatch = line.match(/^\s(.+?)\s+\|/);
    if (fileMatch) filesChanged.push(fileMatch[1].trim());
    const insMatch = line.match(/(\d+) insertion/);
    if (insMatch) insertions = parseInt(insMatch[1]);
    const delMatch = line.match(/(\d+) deletion/);
    if (delMatch) deletions = parseInt(delMatch[1]);
  }

  return c.json({ diff, files_changed: filesChanged, insertions, deletions });
});

app.post("/:id/git/commit", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);
  if (!craftsman.container_id) return c.json({ error: "No container" }, 400);

  const body = await c.req.json();
  const { message } = body;
  if (!message) return c.json({ error: "message is required" }, 400);

  const output = await gitCommit(craftsman.container_id, message);

  // Extract commit SHA from git output: "[branch abc1234] message"
  const shaMatch = output.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
  const commitSha = shaMatch?.[1] ?? "";

  // Count files changed from the commit summary line
  const filesMatch = output.match(/(\d+) file/);
  const filesChanged = filesMatch ? parseInt(filesMatch[1]) : 0;

  if (output.includes("nothing to commit")) {
    return c.json({ ok: false, error: "nothing to commit" }, 400);
  }

  return c.json({ ok: true, commit_sha: commitSha, files_changed: filesChanged, output });
});

app.post("/:id/git/push", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);
  if (!craftsman.container_id) return c.json({ error: "No container" }, 400);

  const branchName = `craftsman/${craftsman.name}`;
  const output = await gitPush(craftsman.container_id, branchName);

  return c.json({ ok: true, branch: branchName, output });
});

app.post("/:id/git/pr", async (c) => {
  const craftsman = findCraftsman(c.req.param("id"));
  if (!craftsman) return c.json({ error: "Craftsman not found" }, 404);

  const project = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(craftsman.project_id) as Project | undefined;

  if (!project) return c.json({ error: "Project not found" }, 404);
  if (!project.github_token) {
    return c.json({ error: "No GitHub token configured for this project" }, 400);
  }

  const body = await c.req.json();
  const { title, body: prBody = "" } = body;
  if (!title) return c.json({ error: "title is required" }, 400);

  // Parse owner/repo from repo_url (handles .git suffix and trailing slashes)
  const repoUrl = new URL(project.repo_url.replace(/\.git$/, "").replace(/\/$/, ""));
  const parts = repoUrl.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return c.json({ error: "Could not parse owner/repo from repo_url" }, 400);
  }
  const [owner, repo] = parts;

  const branchName = `craftsman/${craftsman.name}`;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${project.github_token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title,
        body: prBody,
        head: branchName,
        base: project.branch,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    return c.json(
      { error: `GitHub API error: ${errorText}` },
      response.status as any
    );
  }

  const pr = (await response.json()) as { html_url: string; number: number };
  return c.json({ ok: true, pr_url: pr.html_url, pr_number: pr.number });
});

export default app;
