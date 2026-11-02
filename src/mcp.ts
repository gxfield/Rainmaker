/**
 * A minimal MCP server over Streamable HTTP: JSON-RPC requests arrive as POSTs
 * and get plain JSON responses (no SSE stream, no sessions). That's all a
 * tools-only server needs, and it keeps Rainmaker free of runtime dependencies.
 */

export interface ToolContext {
  /** Who is calling, for audit fields such as `answered_by`. */
  caller: string;
}

export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

export interface McpServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export class ToolInputError extends Error {}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

async function handleOne(msg: JsonRpcRequest, tools: McpTool[], info: McpServerInfo, ctx: ToolContext): Promise<object | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid request");
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0" as const, id: msg.id, result });

  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: info.name, version: info.version },
        ...(info.instructions ? { instructions: info.instructions } : {}),
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: tools.map((t) => ({
          name: t.name,
          ...(t.title ? { title: t.title } : {}),
          description: t.description,
          inputSchema: t.inputSchema,
          ...(t.annotations ? { annotations: t.annotations } : {}),
        })),
      });
    case "tools/call": {
      const name = msg.params?.name;
      const tool = tools.find((t) => t.name === name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${String(name)}`);
      try {
        const result = await tool.handler((msg.params?.arguments ?? {}) as Record<string, unknown>, ctx);
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        const structured = result && typeof result === "object" && !Array.isArray(result) ? { structuredContent: result } : {};
        return ok({ content: [{ type: "text", text }], ...structured });
      } catch (err) {
        return ok({ content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Handles one POST body. Returns the JSON response, or null when the body held only notifications (HTTP 202). */
export async function handleMcpBody(body: string, tools: McpTool[], info: McpServerInfo, ctx: ToolContext): Promise<object | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  if (Array.isArray(parsed)) {
    const results = (await Promise.all(parsed.map((m) => handleOne(m as JsonRpcRequest, tools, info, ctx)))).filter((r) => r !== null);
    return results.length ? results : null;
  }
  return handleOne(parsed as JsonRpcRequest, tools, info, ctx);
}

// Small argument helpers for tool handlers.

export function str(args: Record<string, unknown>, key: string, opts: { required?: boolean; max?: number } = {}): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    if (opts.required) throw new ToolInputError(`"${key}" is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new ToolInputError(`"${key}" must be a string`);
  if (opts.max && value.length > opts.max) throw new ToolInputError(`"${key}" is longer than ${opts.max} characters`);
  return value;
}

export function int(args: Record<string, unknown>, key: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    if (opts.required) throw new ToolInputError(`"${key}" is required`);
    return undefined;
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) throw new ToolInputError(`"${key}" must be a whole number`);
  if (opts.min !== undefined && n < opts.min) throw new ToolInputError(`"${key}" must be at least ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new ToolInputError(`"${key}" must be at most ${opts.max}`);
  return n;
}

export function strList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new ToolInputError(`"${key}" must be a list of strings`);
  return value as string[];
}
