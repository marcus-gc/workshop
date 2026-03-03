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
  task: string | null;
  created_at: string;
  updated_at: string;
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
  task?: string;
}

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
