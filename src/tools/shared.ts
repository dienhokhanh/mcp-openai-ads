import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AdsClient } from "../client.js";
import type { Config } from "../config.js";

export interface ToolContext {
  server: McpServer;
  client: AdsClient;
  config: Config;
}

export const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });

export const errorResult = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }], isError: true });

/** Runs a tool body, turning thrown errors into readable MCP error results instead of protocol failures. */
export async function safely(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return errorResult((err as Error).message ?? String(err));
  }
}

export const paginationShape = {
  limit: z.number().int().min(1).max(500).optional().describe("Page size (default 20, max 500)."),
  after: z.string().optional().describe("Cursor: return results after this id (use last_id from the previous page)."),
  order: z.enum(["asc", "desc"]).optional(),
};

export const confirmShape = {
  confirm: z
    .boolean()
    .optional()
    .describe("Must be true to actually execute. When omitted or false, the tool returns a dry-run preview of the request."),
};

export function dryRun(method: string, path: string, body?: unknown, before?: unknown): CallToolResult {
  const parts = [`DRY RUN (nothing was changed). Would send: ${method} ${path}`];
  if (body !== undefined) parts.push("Body:\n```json\n" + JSON.stringify(body, null, 2) + "\n```");
  if (before !== undefined) parts.push("Current state:\n```json\n" + JSON.stringify(before, null, 2) + "\n```");
  parts.push("Call again with confirm=true to execute.");
  return text(parts.join("\n\n"));
}

/** Shallow diff of the keys that the request touched, for before/after reporting. */
export function diff(before: Record<string, any>, after: Record<string, any>, keys: string[]): string {
  const lines = keys
    .filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
    .map((k) => `- ${k}: ${JSON.stringify(before?.[k])} -> ${JSON.stringify(after?.[k])}`);
  return lines.length ? "Changes:\n" + lines.join("\n") : "No field changes detected.";
}

export const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
