export interface Project {
  id: string;
  name: string;
  repo_url: string;
  branch: string;
  has_github_token: boolean;
  setup_cmd: string | null;
  ports: string; // JSON array string e.g. "[3000]"
  created_at: string;
}

export interface Craftsman {
  id: string;
  name: string;
  project_id: string;
  container_id: string | null;
  status: 'pending' | 'starting' | 'running' | 'stopped' | 'error';
  error_message: string | null;
  session_id: string | null;
  port_mappings: string; // JSON object string e.g. {"3000": 32768}
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  craftsman_id: string;
  role: 'user' | 'assistant';
  content: string;
  cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface DiffResult {
  diff: string;
  files_changed: string[];
  insertions: number;
  deletions: number;
}

export interface CommitResult {
  ok: boolean;
  commit_sha: string;
  files_changed: number;
  output: string;
}

export interface PushResult {
  ok: boolean;
  branch: string;
  output: string;
}

export interface PRResult {
  ok: boolean;
  pr_url: string;
  pr_number: number;
}

export interface StatsResult {
  id: string;
  name: string;
  cpu_percent: number;
  memory_mb: number;
  memory_limit_mb: number;
  pids: number;
}

export interface CreateProjectPayload {
  name: string;
  repo_url: string;
  branch?: string;
  github_token?: string;
  setup_cmd?: string;
  ports?: number[];
}

export interface CreateCraftsmanPayload {
  name: string;
  project_id: string;
}

// Stream event types from /api/craftsmen/:id/messages/stream
export type StreamEventType =
  | { type: 'system'; subtype: string; [k: string]: unknown }
  | { type: 'assistant'; message: { content: AssistantContent[] } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown }
  | { type: 'result'; result: string; session_id: string; total_cost_usd: number; duration_ms: number }
  | { type: 'done'; result: string; session_id: string; cost_usd: number; duration_ms: number; message_id: string }
  | { type: 'error'; error: string };

export type AssistantContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown };

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  clone_url: string;
  default_branch: string;
  description: string | null;
  private: boolean;
  updated_at: string;
}
