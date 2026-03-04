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
  dynamic_ports: string; // JSON array of container ports with active proxies
  task: string | null;
  created_at: string;
  updated_at: string;
}
