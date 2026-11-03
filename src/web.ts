import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./api.ts";
import type { Clis } from "./clis.ts";
import type { Store } from "./db.ts";
import type { Engine } from "./engine.ts";
import { errorMessage } from "./log.ts";
import { handleMcpBody, type McpTool } from "./mcp.ts";
import type { Questions } from "./questions.ts";
import { agentTools, hermesTools } from "./tools.ts";
import type { Config } from "./settings.ts";

export interface WebDeps {
  store: Store;
  config: Config;
  engine: Engine;
  clis: Clis;
  questions: Questions;
  version: string;
  /** The built dashboard (web/dist). Defaults to the copy next to the source. */
  webDir?: string;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const DEFAULT_WEB_DIR = fileURLToPath(new URL("../web/dist", import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
};

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>Rainmaker</title>
<body style="font:15px system-ui;background:#121212;color:#eee;padding:40px">
<h1>Rainmaker</h1><p>The dashboard hasn't been built. Run <code>npm --prefix web ci && npm --prefix web run build</code>, or use the Docker image, which builds it.</p>`;

function send(res: ServerResponse, status: number, body: string | Buffer, type = "text/html; charset=utf-8", cache = "no-store"): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": cache, "X-Frame-Options": "SAMEORIGIN", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  send(res, status, JSON.stringify(data, null, 2), "application/json");
}

/**
 * Serves the built single-page dashboard. Hashed files under assets/ are cached for a year;
 * everything else, including index.html for any page path, is never cached.
 */
function serveStatic(res: ServerResponse, root: string, path: string): void {
  const index = join(root, "index.html");
  if (!existsSync(index)) return send(res, 200, NOT_BUILT);
  const file = normalize(join(root, decodeURIComponent(path)));
  if (file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()) {
    const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    return send(res, 200, readFileSync(file), TYPES[extname(file)] ?? "application/octet-stream", cache);
  }
  send(res, 200, readFileSync(index), TYPES[".html"], "no-cache");
}

function bearer(req: IncomingMessage): string | undefined {
  return /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
}

async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error("Request too large");
  }
  return body;
}

async function serveMcp(req: IncomingMessage, res: ServerResponse, path: string, deps: WebDeps, hermes: McpTool[]): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Use POST. This server answers with JSON and does not open SSE streams." }));
    return;
  }
  const token = bearer(req);
  let tools: McpTool[];
  let caller: string;
  if (path === "/mcp/agent") {
    const jobId = token && LOOPBACK.has(req.socket.remoteAddress ?? "") ? deps.engine.jobForAgentToken(token) : undefined;
    if (jobId === undefined) return json(res, { error: "Unauthorized" }, 401);
    tools = agentTools(deps.engine, jobId);
    caller = `job #${jobId}`;
  } else {
    if (!token || !deps.config.checkMcpToken(token)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="rainmaker"');
      return json(res, { error: "Unauthorized: send the token from Rainmaker's Settings page as a Bearer token" }, 401);
    }
    tools = hermes;
    caller = "MCP";
  }
  const reply = await handleMcpBody(await readBody(req), tools, {
    name: "rainmaker",
    version: deps.version,
    instructions:
      path === "/mcp"
        ? "Rainmaker runs Claude Code or Codex on GitHub issues and opens pull requests. Use create_task or start_issue to start work, list_jobs and get_job to follow it, and list_questions and answer_question when an agent is waiting on a decision."
        : undefined,
  }, { caller });
  if (reply === null) {
    res.writeHead(202);
    res.end();
    return;
  }
  json(res, reply);
}

export function createWebServer(deps: WebDeps): Server {
  const hermes = hermesTools(deps);
  const webDir = normalize(deps.webDir ?? DEFAULT_WEB_DIR);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/mcp" || path === "/mcp/agent") return await serveMcp(req, res, path, deps, hermes);
      if (path === "/healthz") return json(res, { ok: true, version: deps.version });
      if (await handleApi(req, res, path, url, deps)) return;
      if (req.method === "GET" || req.method === "HEAD") return serveStatic(res, webDir, url.pathname);
      send(res, 404, "Not found", "text/plain");
    } catch (err) {
      if (!res.headersSent) json(res, { error: errorMessage(err) }, 500);
      else res.end();
    }
  });
  // ask_human calls hold a request open while the agent waits for an answer.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  return server;
}
