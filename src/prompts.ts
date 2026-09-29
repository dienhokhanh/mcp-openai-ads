import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const user = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "weekly_performance_review",
    {
      title: "Weekly performance review",
      description: "Review the last 7 days of ChatGPT Ads performance and suggest actions.",
      argsSchema: { days: z.string().optional().describe("Number of days (default 7).") },
    },
    ({ days }) =>
      user(
        `Use the OpenAI Ads tools to review the last ${days || 7} days. ` +
          "1) Call account_summary. 2) Call get_insights at level=ad_group and level=ad for the same period. " +
          "3) Summarise spend, clicks, CTR and CPC; call out the best and worst campaigns/ad groups/ads. " +
          "4) List any serving issues or ads rejected in review. 5) Recommend concrete next steps (budget shifts, pauses, creative tests). " +
          "Do not change anything; only recommend.",
      ),
  );

  server.registerPrompt(
    "find_underperformers",
    {
      title: "Find underperforming ads",
      description: "Find ads with low CTR or high CPC relative to the account average.",
      argsSchema: { days: z.string().optional() },
    },
    ({ days }) =>
      user(
        `Call get_insights with level=ad for the last ${days || 14} days. Compute the account-average CTR and CPC, ` +
          "then list ads with at least 500 impressions whose CTR is below 50% of average or CPC above 150% of average. " +
          "For each, fetch the ad with get_ad and suggest a creative improvement. Do not pause anything without asking me.",
      ),
  );

  server.registerPrompt(
    "diagnose_not_serving",
    {
      title: "Diagnose why ads are not serving",
      description: "Check account review, spend limits, campaigns, ad groups and ads for serving issues.",
    },
    () =>
      user(
        "Diagnose why my ChatGPT ads may not be serving. Check get_ad_account (brand/integrity review), get_spend_limits, " +
          "list_campaigns, list_ad_groups and list_ads, and explain each serving_issues code found with a fix.",
      ),
  );
}
