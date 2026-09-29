import { z } from "zod";
import type { AdsClient } from "../client.js";
import { issues, money, table, type Page } from "../format.js";
import { READ_ONLY, safely, text, type ToolContext } from "./shared.js";

export type Level = "ad_account" | "campaign" | "ad_group" | "ad";
const METRICS = ["impressions", "clicks", "spend", "ctr", "cpc", "cpm"];
const NAME_FIELD: Record<Level, string | undefined> = {
  ad_account: "name",
  campaign: "name",
  ad_group: "name",
  ad: "title",
};

/** Default canonical fields for a level, e.g. campaign.id, campaign.name, campaign.clicks. */
export function defaultFields(level: Level, granularity: string): string[] {
  const f = [`${level}.id`];
  if (NAME_FIELD[level]) f.push(`${level}.${NAME_FIELD[level]}`);
  f.push(...METRICS.map((m) => `${level}.${m}`));
  if (granularity !== "none") f.unshift("metadata.readable_time");
  return f;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Resolves since/until or last_n_days into the API's date_range time_ranges entry. */
export function timeRange(opts: { since?: string; until?: string; last_n_days?: number }, now = new Date()): string {
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1); // today's attribution data is preliminary
  let { since, until } = opts;
  if (!since) {
    const end = until ? new Date(`${until}T00:00:00Z`) : yesterday;
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - ((opts.last_n_days ?? 7) - 1));
    since = isoDate(start);
    until = isoDate(end);
  } else if (!until) {
    // Open-ended "since X" means up to yesterday, unless X itself is later.
    until = since > isoDate(yesterday) ? since : isoDate(yesterday);
  }
  if (since > until) throw new Error(`since (${since}) must be on or before until (${until}).`);
  return JSON.stringify({ type: "date_range", since, until });
}

/** Drops columns where every row is null/undefined (the insights schema has many sparse columns). */
export function compactRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const keep = new Set<string>();
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined && v !== "") keep.add(k);
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))));
}

const filterSchema = z.object({
  field: z.string().describe('Canonical field, e.g. "campaign.id" or "ad.clicks".'),
  operator: z.enum(["IN", "GREATER_THAN", "LESS_THAN"]),
  value: z.union([z.array(z.union([z.string(), z.number()])), z.string(), z.number()]),
});

export interface InsightsArgs {
  level: Level;
  campaign_id?: string;
  ad_group_id?: string;
  ad_id?: string;
  since?: string;
  until?: string;
  last_n_days?: number;
  time_granularity?: "none" | "hourly" | "daily" | "monthly";
  segment?: "product" | "country" | "device" | "platform";
  fields?: string[];
  filters?: z.infer<typeof filterSchema>[];
  sort?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  after?: string;
}

export async function fetchInsights(client: AdsClient, a: InsightsArgs): Promise<Page<Record<string, unknown>>> {
  const granularity = a.time_granularity ?? "none";
  const path = a.ad_id
    ? `/ads/${encodeURIComponent(a.ad_id)}/insights`
    : a.ad_group_id
      ? `/ad_groups/${encodeURIComponent(a.ad_group_id)}/insights`
      : a.campaign_id
        ? `/campaigns/${encodeURIComponent(a.campaign_id)}/insights`
        : "/ad_account/insights";
  return client.get(path, {
    time_granularity: granularity,
    aggregation_level: a.level,
    time_ranges: [timeRange(a)],
    fields: a.fields?.length ? a.fields : defaultFields(a.level, granularity),
    filters: a.filters?.map((f) => JSON.stringify(f)),
    sort: a.sort ? [JSON.stringify(a.sort)] : undefined,
    segments: a.segment ? [a.segment] : undefined,
    limit: a.limit,
    after: a.after,
  });
}

export function registerInsightsTools({ server, client, config }: ToolContext) {
  server.registerTool(
    "get_insights",
    {
      title: "Get performance insights",
      description: [
        "Performance report (impressions, clicks, spend, CTR, CPC, CPM) for the ad account, broken down by campaign, ad group or ad.",
        "Date range: pass since/until (YYYY-MM-DD, inclusive, account timezone; until defaults to yesterday) or last_n_days (default 7, ending yesterday).",
        "Scope to one entity with campaign_id / ad_group_id / ad_id. Optional one-dimension segment: product, country, device, platform.",
        "Spend values are in account currency units (not micros). Today's attribution metrics are preliminary.",
        'Advanced: pass canonical fields like "campaign.roas", "ad.cpa", "country.name", filters and sort.',
      ].join(" "),
      inputSchema: {
        level: z.enum(["ad_account", "campaign", "ad_group", "ad"]).default("campaign").describe("Aggregation level (row granularity)."),
        campaign_id: z.string().optional(),
        ad_group_id: z.string().optional(),
        ad_id: z.string().optional(),
        since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        last_n_days: z.number().int().min(1).max(365).optional(),
        time_granularity: z.enum(["none", "hourly", "daily", "monthly"]).optional().describe("Default none (one row per entity)."),
        segment: z.enum(["product", "country", "device", "platform"]).optional(),
        fields: z.array(z.string()).optional().describe("Canonical field names. Defaults to id, name and core metrics for the level."),
        filters: z.array(filterSchema).optional(),
        sort: z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }).optional(),
        limit: z.number().int().min(1).max(2000).optional(),
        after: z.string().optional(),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      safely(async () => {
        const page = await fetchInsights(client, args as InsightsArgs);
        const rows = compactRows(page.data ?? []).slice(0, config.maxRows);
        let out = table(rows);
        if ((page.data?.length ?? 0) > rows.length) out += `\n\n(Truncated to ${rows.length} rows; set OPENAI_ADS_MAX_ROWS to change.)`;
        if (page.has_more) out += `\n\nMore rows available. Call again with after="${page.last_id}".`;
        return text(out);
      }),
  );

  server.registerTool(
    "account_summary",
    {
      title: "Account summary",
      description:
        "One-shot snapshot: account status, active campaigns with budgets and serving issues, and per-campaign performance for the last N days (default 7).",
      inputSchema: { last_n_days: z.number().int().min(1).max(90).optional() },
      annotations: READ_ONLY,
    },
    ({ last_n_days }) =>
      safely(async () => {
        const days = last_n_days ?? 7;
        const [account, campaigns, perf] = await Promise.all([
          client.get("/ad_account"),
          client.get<Page<any>>("/campaigns", { limit: 500, include: ["serving_issues"] }),
          fetchInsights(client, { level: "campaign", last_n_days: days, limit: 2000 }),
        ]);
        const byId = new Map((perf.data ?? []).map((r: any) => [r.campaign_id ?? r.id, r]));
        const rows = campaigns.data
          .filter((c) => c.status !== "archived")
          .map((c) => {
            const p: any = byId.get(c.id) ?? {};
            return {
              campaign: c.name,
              id: c.id,
              status: c.status,
              daily_budget: money(c.budget?.daily_spend_limit_micros),
              impressions: p.campaign_impressions ?? p.impressions ?? 0,
              clicks: p.campaign_clicks ?? p.clicks ?? 0,
              spend: p.campaign_spend ?? p.spend ?? 0,
              ctr: p.campaign_ctr ?? p.ctr,
              cpc: p.campaign_cpc ?? p.cpc,
              serving_issues: issues(c.serving_issues),
            };
          });
        const totals = rows.reduce(
          (t, r) => ({
            impressions: t.impressions + Number(r.impressions || 0),
            clicks: t.clicks + Number(r.clicks || 0),
            spend: t.spend + Number(r.spend || 0),
          }),
          { impressions: 0, clicks: 0, spend: 0 },
        );
        const header = `Account: ${account.name} (${account.id}), status ${account.status ?? "unknown"}, currency ${account.currency_code}, timezone ${account.timezone}, brand review ${account.review?.status}.`;
        const tot = `Last ${days} days (to yesterday): ${totals.impressions} impressions, ${totals.clicks} clicks, ${totals.spend.toFixed(2)} ${account.currency_code} spend, CTR ${totals.impressions ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : "0"}%.`;
        const more =
          campaigns.has_more || perf.has_more
            ? "\n\nNote: this account has more campaigns than one page returns; totals cover the first 500. Use list_campaigns / get_insights with pagination for the rest."
            : "";
        return text(`${header}\n${tot}\n\n${table(rows)}${more}`);
      }),
  );
}
