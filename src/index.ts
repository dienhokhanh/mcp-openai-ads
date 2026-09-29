#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

async function main() {
  const arg = process.argv[2];
  if (arg === "--version" || arg === "-v") {
    console.log(VERSION);
    return;
  }
  if (arg === "--help" || arg === "-h") {
    console.log(`mcp-openai-ads ${VERSION} - MCP server for the OpenAI Ads Advertiser API (stdio)

Environment:
  OPENAI_ADS_API_KEY       (required) Advertiser API key from https://ads.openai.com/settings
  OPENAI_ADS_ALLOW_WRITES  set to "true" to enable create/update/pause tools (default: read-only)
  OPENAI_ADS_MAX_ROWS      max report rows returned per call (default 200)
  OPENAI_ADS_BASE_URL      override API base URL (default https://api.ads.openai.com/v1)`);
    return;
  }

  const config = loadConfig();
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; log to stderr only.
  console.error(`mcp-openai-ads ${VERSION} running on stdio (${config.allowWrites ? "read/write" : "read-only"})`);
}

main().catch((err) => {
  console.error(`mcp-openai-ads: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
