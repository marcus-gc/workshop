import httpProxy from "http-proxy";
import { IncomingMessage, ServerResponse } from "http";

const proxyServer = httpProxy.createProxyServer({});

proxyServer.on("error", (err, _req, res) => {
  console.error("Proxy error:", err.message);
  if (res instanceof ServerResponse && !res.headersSent) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Proxy error", message: err.message }));
  }
});

export function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  hostPort: number,
  path: string
) {
  req.url = path || "/";
  proxyServer.web(req, res, {
    target: `http://127.0.0.1:${hostPort}`,
  });
}
