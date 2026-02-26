export interface Project {
  id: string;
  name: string;
  repo_url: string;
  branch: string;
  github_token: string | null;
  setup_cmd: string | null;
  ports: string; // JSON array
  created_at: string;
}

export interface Craftsman {
  id: string;
  name: string;
  project_id: string;
  container_id: string | null;
  status: "pending" | "starting" | "running" | "stopped" | "error";
  error_message: string | null;
  session_id: string | null;
  port_mappings: string; // JSON object
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  craftsman_id: string;
  role: "user" | "assistant";
  content: string;
  cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface ClaudeResponse {
  result: string;
  session_id: string;
  cost_usd: number;
  duration_ms: number;
}

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}
