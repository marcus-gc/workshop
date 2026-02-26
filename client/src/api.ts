import type {
  Project,
  Craftsman,
  Message,
  DiffResult,
  CommitResult,
  PushResult,
  PRResult,
  StatsResult,
  CreateProjectPayload,
  CreateCraftsmanPayload,
  GitHubRepo,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    let msg = body;
    try {
      msg = JSON.parse(body).error ?? body;
    } catch {}
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Projects ──────────────────────────────────────────────────────────────────

export function listProjects(): Promise<Project[]> {
  return request('/api/projects');
}

export function createProject(data: CreateProjectPayload): Promise<Project> {
  return request('/api/projects', { method: 'POST', body: JSON.stringify(data) });
}

export function deleteProject(id: string): Promise<void> {
  return request(`/api/projects/${id}`, { method: 'DELETE' });
}

// ── Craftsmen ─────────────────────────────────────────────────────────────────

export function listCraftsmen(): Promise<Craftsman[]> {
  return request('/api/craftsmen');
}

export function getCraftsman(id: string): Promise<Craftsman> {
  return request(`/api/craftsmen/${id}`);
}

export function createCraftsman(data: CreateCraftsmanPayload): Promise<Craftsman> {
  return request('/api/craftsmen', { method: 'POST', body: JSON.stringify(data) });
}

export function stopCraftsman(id: string): Promise<void> {
  return request(`/api/craftsmen/${id}/stop`, { method: 'POST' });
}

export function startCraftsman(id: string): Promise<void> {
  return request(`/api/craftsmen/${id}/start`, { method: 'POST' });
}

export function deleteCraftsman(id: string): Promise<void> {
  return request(`/api/craftsmen/${id}`, { method: 'DELETE' });
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function listMessages(craftsmanId: string): Promise<Message[]> {
  return request(`/api/craftsmen/${craftsmanId}/messages`);
}

/** Returns the raw Response — caller reads the SSE body stream */
export function sendMessageStream(craftsmanId: string, content: string): Promise<Response> {
  return fetch(`/api/craftsmen/${craftsmanId}/messages/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

// ── Git ───────────────────────────────────────────────────────────────────────

export function getDiff(craftsmanId: string): Promise<DiffResult> {
  return request(`/api/craftsmen/${craftsmanId}/diff`);
}

export function gitCommit(craftsmanId: string, message: string): Promise<CommitResult> {
  return request(`/api/craftsmen/${craftsmanId}/git/commit`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function gitPush(craftsmanId: string): Promise<PushResult> {
  return request(`/api/craftsmen/${craftsmanId}/git/push`, { method: 'POST' });
}

export function openPR(craftsmanId: string, title: string, body: string): Promise<PRResult> {
  return request(`/api/craftsmen/${craftsmanId}/git/pr`, {
    method: 'POST',
    body: JSON.stringify({ title, body }),
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function getStats(craftsmanId: string): Promise<StatsResult> {
  return request(`/api/craftsmen/${craftsmanId}/stats`);
}

// ── GitHub API (external) ─────────────────────────────────────────────────────

export async function validateGitHubToken(token: string): Promise<{ login: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Invalid GitHub token');
  return res.json();
}

export async function listGitHubRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&sort=updated&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error('Failed to fetch repos');
    const batch: GitHubRepo[] = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}
