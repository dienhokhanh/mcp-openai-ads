import { z } from "zod";
import { issues, money, pageFooter, table, unixToIso, type Page } from "../format.js";
import { READ_ONLY, paginationShape, safely, text, type ToolContext } from "./shared.js";

const rawShape = z.boolean().optional().describe("Also return the full API object as JSON (targeting, bidding config, review details).");

const json = (v: unknown) => "```json\n" + JSON.stringify(v, null, 2) + "\n```";

const campaignRow = (c: any) => ({
  id: c.id,
  name: c.name,
  status: c.status,
  mode: c.mode,
  objective: c.objective,
  bidding: c.bidding_type,
  daily_budget: money(c.budget?.daily_spend_limit_micros),
  lifetime_budget: money(c.budget?.lifetime_spend_limit_micros),
  countries: (c.targeting?.locations?.countries ?? []).join(","),
  start: unixToIso(c.start_time),
  end: unixToIso(c.end_time),
  serving_issues: issues(c.serving_issues),
});

const adGroupRow = (g: any) => ({
  id: g.id,
  name: g.name,
  status: g.status,
  strategy: g.bidding_config?.strategy,
  billing: g.bidding_config?.billing_event_type,
  max_bid: money(g.bidding_config?.max_bid_micros),
  context_hints: (g.context_hints ?? []).join("; "),
  serving_issues: issues(g.serving_issues),
});

const adRow = (a: any) => ({
  id: a.id,
  name: a.name,
  status: a.status,
  review: a.review_status,
  review_reason: a.review?.reason,
  type: a.creative?.type,
  title: a.creative?.title,
  body: a.creative?.body,
  target_url: a.creative?.target_url,
  serving_issues: issues(a.serving_issues),
});

export function registerReadTools({ server, client }: ToolContext) {
  server.registerTool(
    "get_ad_account",
    {
      title: "Get ad account",
      description:
        "Get the ad account tied to the API key: name, URL, status, currency, timezone and brand/integrity review status. Money values in other tools are in this account's currency.",
      annotations: READ_ONLY,
    },
    () =>
      safely(async () => {
        const a = await client.get("/ad_account");
        return text(
          table([
            {
              id: a.id,
              name: a.name,
              url: a.url,
              status: a.status,
              currency: a.currency_code,
              timezone: a.timezone,
              brand_review: a.review?.status,
              brand_review_reason: a.review?.reason,
              integrity_review: a.account_integrity_review?.review?.status,
            },
          ]),
        );
      }),
  );

  server.registerTool(
    "get_spend_limits",
    {
      title: "Get spend limits",
      description: "Get the ad account's daily spend limit and dated spend-limit windows, with amounts spent and remaining.",
      annotations: READ_ONLY,
    },
    () =>
      safely(async () => {
        const r = await client.get("/ad_account/spend_limit_windows");
        const out: string[] = [];
        const daily = r.daily_limit;
        if (daily) {
          out.push(
            "Daily limit:\n" +
              table([
                {
                  amount: money(daily.amount_micros),
                  spent: money(daily.spent_micros),
                  remaining: money(daily.remaining_micros),
                  status: daily.status,
                  timezone: daily.timezone,
                  next_reset: daily.next_reset,
                },
              ]),
          );
        } else out.push("Daily limit: none set.");
        out.push(
          "Spend-limit windows:\n" +
            table(
              (r.data ?? []).map((w: any) => ({
                window_id: w.window_id,
                name: w.name,
                start: w.start_date,
                end: w.end_date,
                amount: money(w.amount_micros),
                spent: money(w.spent_micros),
                status: w.status,
              })),
            ),
        );
        return text(out.join("\n\n"));
      }),
  );

  server.registerTool(
    "list_campaigns",
    {
      title: "List campaigns",
      description: "List campaigns with status, budget (account currency), targeting countries and serving issues.",
      inputSchema: { name: z.string().optional().describe("Filter by campaign name."), ...paginationShape },
      annotations: READ_ONLY,
    },
    (args) =>
      safely(async () => {
        const page: Page<any> = await client.get("/campaigns", { ...args, include: ["serving_issues"] });
        return text(table(page.data.map(campaignRow)) + pageFooter(page));
      }),
  );

  server.registerTool(
    "get_campaign",
    {
      title: "Get campaign",
      description: "Get full details of one campaign, including targeting and serving issues.",
      inputSchema: { campaign_id: z.string(), raw: rawShape },
      annotations: READ_ONLY,
    },
    ({ campaign_id, raw }) =>
      safely(async () => {
        const c = await client.get(`/campaigns/${encodeURIComponent(campaign_id)}`);
        return text(table([campaignRow(c)]) + (raw ? "\n\nRaw:\n" + json(c) : ""));
      }),
  );

  server.registerTool(
    "list_ad_groups",
    {
      title: "List ad groups",
      description: "List ad groups, optionally for one campaign, with bid strategy, max bid and context hints.",
      inputSchema: {
        campaign_id: z.string().optional(),
        name: z.string().optional(),
        ...paginationShape,
      },
      annotations: READ_ONLY,
    },
    (args) =>
      safely(async () => {
        const page: Page<any> = await client.get("/ad_groups", { ...args, include: ["serving_issues"] });
        return text(table(page.data.map(adGroupRow)) + pageFooter(page));
      }),
  );

  server.registerTool(
    "get_ad_group",
    {
      title: "Get ad group",
      description: "Get full details of one ad group.",
      inputSchema: { ad_group_id: z.string(), raw: rawShape },
      annotations: READ_ONLY,
    },
    ({ ad_group_id, raw }) =>
      safely(async () => {
        const g = await client.get(`/ad_groups/${encodeURIComponent(ad_group_id)}`);
        return text(table([adGroupRow(g)]) + (raw ? "\n\nRaw:\n" + json(g) : ""));
      }),
  );

  server.registerTool(
    "list_ads",
    {
      title: "List ads",
      description: "List ads, optionally for one ad group, with creative text, review status and serving issues.",
      inputSchema: {
        ad_group_id: z.string().optional(),
        name: z.string().optional(),
        ...paginationShape,
      },
      annotations: READ_ONLY,
    },
    (args) =>
      safely(async () => {
        const page: Page<any> = await client.get("/ads", { ...args, include: ["serving_issues"] });
        return text(table(page.data.map(adRow)) + pageFooter(page));
      }),
  );

  server.registerTool(
    "get_ad",
    {
      title: "Get ad",
      description: "Get full details of one ad, including creative, review and appeal status.",
      inputSchema: { ad_id: z.string(), raw: rawShape },
      annotations: READ_ONLY,
    },
    ({ ad_id, raw }) =>
      safely(async () => {
        const a = await client.get(`/ads/${encodeURIComponent(ad_id)}`);
        return text(table([adRow(a)]) + (raw ? "\n\nRaw:\n" + json(a) : ""));
      }),
  );

  server.registerTool(
    "preview_ad",
    {
      title: "Preview ad",
      description: "Render a preview of how an ad will look in ChatGPT. Does not change the ad.",
      inputSchema: { ad_id: z.string() },
      annotations: READ_ONLY,
    },
    ({ ad_id }) =>
      safely(async () => {
        const r = await client.post(`/ads/${encodeURIComponent(ad_id)}/preview`);
        return text((r.data ?? []).map((d: any) => d.body).join("\n\n---\n\n") || "_No preview returned._");
      }),
  );

  server.registerTool(
    "list_product_feeds",
    {
      title: "List product feeds",
      description: "List product feeds with countries, currencies, product and campaign counts.",
      inputSchema: {
        limit: paginationShape.limit,
        after: paginationShape.after,
      },
      annotations: READ_ONLY,
    },
    (args) =>
      safely(async () => {
        const page: Page<any> = await client.get("/feeds", { ...args, include: ["product_count"] });
        const rows = page.data.map((f) => ({
          feed_id: f.feed_id,
          name: f.name,
          countries: (f.countries ?? []).join(","),
          currencies: (f.currencies ?? []).join(","),
          products: f.product_count,
          campaigns: f.campaign_count,
          shopify: f.is_shopify_managed,
          updated_at: f.updated_at,
        }));
        return text(table(rows) + pageFooter(page));
      }),
  );

  server.registerTool(
    "list_conversion_setup",
    {
      title: "List conversion setup",
      description: "List conversion pixels/sources and conversion event settings (event type, attribution window, linked campaigns).",
      annotations: READ_ONLY,
    },
    () =>
      safely(async () => {
        const [pixels, settings] = await Promise.all([
          client.get<Page<any>>("/conversions/pixels", { limit: 100 }),
          client.get<Page<any>>("/conversions/event_settings", { limit: 100 }),
        ]);
        const px = table(pixels.data.map((p) => ({ id: p.id, name: p.name, client_type: p.client_type, pixel_id: p.pixel_id })));
        const es = table(
          settings.data.map((s) => ({
            id: s.id,
            name: s.name,
            event_type: s.event_type,
            custom_event: s.custom_event_name,
            attribution_days: s.attribution_window_days,
            campaigns: (s.campaigns ?? []).length,
            archived: s.archived,
          })),
        );
        return text(`Pixels / sources:\n${px}\n\nConversion event settings:\n${es}`);
      }),
  );

  server.registerTool(
    "list_recent_conversion_events",
    {
      title: "List recent conversion events",
      description: "List recent raw conversion events received for a pixel/source. Useful to verify a pixel or Conversions API integration is firing.",
      inputSchema: {
        pixel_id: z.string().describe("The pixel/source id (pid)."),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    ({ pixel_id, limit }) =>
      safely(async () => {
        const r = await client.get<Page<any>>("/conversions/events", { pid: pixel_id, limit });
        const rows = r.data.map((e) => ({
          event_type: e.event_type,
          custom_event: e.custom_event_name,
          source: e.action_source,
          channel: e.api_channel,
          event_time: new Date(e.event_timestamp_ms).toISOString(),
          received: new Date(e.received_at_ms).toISOString(),
        }));
        return text(table(rows));
      }),
  );

  server.registerTool(
    "geo_lookup",
    {
      title: "Geo lookup",
      description: "Search locations (cities, regions, countries) to get ids for campaign location targeting.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
      annotations: READ_ONLY,
    },
    ({ query, limit }) =>
      safely(async () => {
        const r = await client.get("/geo_lookup/search", { q: query, limit });
        const rows = (r.results ?? []).map((g: any) => ({
          id: g.id,
          name: g.canonical_name ?? g.name,
          type: g.type,
          country: g.country_code,
          region: g.region_code,
        }));
        return text(table(rows));
      }),
  );
}
