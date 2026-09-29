import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdsClient } from "./client.js";
import type { Config } from "./config.js";
import { registerPrompts } from "./prompts.js";
import { registerInsightsTools } from "./tools/insights.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { NAME, VERSION } from "./version.js";

export function createServer(config: Config, client = new AdsClient({ apiKey: config.apiKey, baseUrl: config.baseUrl })) {
  const server = new McpServer(
    { name: NAME, version: VERSION },
    {
      instructions: [
        "Tools for the OpenAI Ads (ads in ChatGPT) Advertiser API.",
        "Budgets and bids in tool inputs are in the ad account's currency units (the server converts to micros).",
        "Start with account_summary for an overview. Write tools default to a dry run; only pass confirm=true after the user approves the change.",
        config.allowWrites ? "" : "Write tools are disabled (OPENAI_ADS_ALLOW_WRITES is not set); the server is read-only.",
      ]
        .filter(Boolean)
        .join(" "),
    },
  );
  const ctx = { server, client, config };
  registerReadTools(ctx);
  registerInsightsTools(ctx);
  if (config.allowWrites) registerWriteTools(ctx);
  registerPrompts(server);
  return server;
}
