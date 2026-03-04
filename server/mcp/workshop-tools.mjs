#!/usr/bin/env node
/**
 * Workshop MCP Server — exposes port-forwarding tools to Claude Code inside craftsman containers.
 * Zero dependencies; uses only Node.js builtins (readline, http).
 * Communicates via JSON-RPC 2.0 over stdin/stdout (line-delimited JSON).
 */

import { createInterface } from "node:readline";
import http from "node:http";

const WORKSHOP_URL = process.env.WORKSHOP_URL || "http://workshop-server:7424";
const CRAFTSMAN_ID = process.env.CRAFTSMAN_ID || "";

const SERVER_INFO = {
  name: "workshop-tools",
  version: "1.0.0",
};

const TOOLS = [
  {
    name: "forward_port",
    description:
      "Forward a container port so it is accessible from the host. " +
      "Use this after starting a dev server or any process that listens on a port.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "The container port number to forward (e.g. 3000, 5173, 8080)",
        },
      },
      required: ["port"],
    },
  },
  {
    name: "list_ports",
    description: "List all currently forwarded ports for this craftsman.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "remove_port_forward",
    description: "Remove a dynamic port forward.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "The container port number to stop forwarding",
        },
      },
      required: ["port"],
    },
  },
];

// ── HTTP helper ──────────────────────────────────────────────────────────────

function httpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, WORKSHOP_URL);
    const payload = body != null ? JSON.stringify(body) : null;

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, data: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode, data: text });
          }
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Tool handlers ────────────────────────────────────────────────────────────

async function handleForwardPort({ port }) {
  const res = await httpRequest(
    "POST",
    `/api/craftsmen/${CRAFTSMAN_ID}/ports`,
    { port }
  );
  if (res.status === 201 || res.status === 200) {
    const hostPort = res.data.host_port;
    return `Port ${port} forwarded successfully. It is now accessible on host port ${hostPort}.`;
  }
  return `Failed to forward port ${port}: ${res.data.error || JSON.stringify(res.data)}`;
}

async function handleListPorts() {
  const res = await httpRequest(
    "GET",
    `/api/craftsmen/${CRAFTSMAN_ID}/ports`
  );
  if (res.status === 200) {
    const ports = res.data;
    if (ports.length === 0) return "No ports are currently forwarded.";
    const lines = ports.map(
      (p) =>
        `  container:${p.container_port} -> host:${p.host_port}${p.dynamic ? " (dynamic)" : " (static)"}`
    );
    return `Forwarded ports:\n${lines.join("\n")}`;
  }
  return `Failed to list ports: ${res.data.error || JSON.stringify(res.data)}`;
}

async function handleRemovePortForward({ port }) {
  const res = await httpRequest(
    "DELETE",
    `/api/craftsmen/${CRAFTSMAN_ID}/ports/${port}`
  );
  if (res.status === 200) {
    return `Port forward for ${port} removed.`;
  }
  return `Failed to remove port forward for ${port}: ${res.data.error || JSON.stringify(res.data)}`;
}

const TOOL_HANDLERS = {
  forward_port: handleForwardPort,
  list_ports: handleListPorts,
  remove_port_forward: handleRemovePortForward,
};

// ── JSON-RPC 2.0 dispatch ────────────────────────────────────────────────────

function makeResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function makeError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  // Notifications (no id) — just acknowledge silently
  if (id === undefined || id === null) return null;

  switch (method) {
    case "initialize":
      return makeResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "tools/list":
      return makeResponse(id, { tools: TOOLS });

    case "tools/call": {
      const toolName = params?.name;
      const handler = TOOL_HANDLERS[toolName];
      if (!handler) {
        return makeResponse(id, {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        });
      }
      try {
        const text = await handler(params.arguments || {});
        return makeResponse(id, {
          content: [{ type: "text", text }],
        });
      } catch (err) {
        return makeResponse(id, {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        });
      }
    }

    default:
      return makeError(id, -32601, `Method not found: ${method}`);
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    const response = await handleMessage(msg);
    if (response) {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  } catch (err) {
    // Parse error
    const errResponse = makeError(null, -32700, "Parse error");
    process.stdout.write(JSON.stringify(errResponse) + "\n");
  }
});

process.stdin.on("end", () => process.exit(0));
