import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { AdsClient } from "../src/client.js";
import { createServer } from "../src/server.js";

const campaign = {
  id: "cmpn_1",
  name: "Fall Sale",
  status: "active",
  budget: { daily_spend_limit_micros: 50_000_000 },
  targeting: { locations: { countries: ["US"] } },
  serving_issues: [{ code: "ad_in_review" }],
};

const adGroup = {
  id: "ag_1",
  name: "Shoes",
  status: "active",
  bidding_config: { billing_event_type: "click", strategy: "automated_bid", max_bid_micros: 1_000_000 },
};

function mockApi() {
  return vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const route = `${init.method} ${u.pathname}`;
    const routes: Record<string, unknown> = {
      "GET /v1/ad_account": { id: "acct_1", name: "Acme", currency_code: "USD", timezone: "UTC", review: { status: "approved" } },
      "GET /v1/campaigns": { object: "list", data: [campaign], has_more: false },
      "GET /v1/campaigns/cmpn_1": campaign,
      "POST /v1/campaigns/cmpn_1/pause": { ...campaign, status: "paused" },
      "POST /v1/campaigns/cmpn_1": { ...campaign, budget: { daily_spend_limit_micros: 80_000_000 } },
      "GET /v1/ad_groups/ag_1": adGroup,
      "POST /v1/ad_groups/ag_1": { ...adGroup, bidding_config: { ...adGroup.bidding_config, max_bid_micros: 2_000_000 } },
      "GET /v1/ad_account/insights": {
        object: "list",
        data: [{ id: "r1", campaign_id: "cmpn_1", campaign_name: "Fall Sale", campaign_impressions: 1000, campaign_clicks: 25, campaign_spend: 12.5, hotel_name: null }],
        has_more: false,
      },
    };
    const body = routes[route];
    if (!body) return new Response(JSON.stringify({ error: { message: `no mock for ${route}` } }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

async function connect(allowWrites: boolean) {
  const fetch = mockApi();
  const config = { apiKey: "k", baseUrl: "https://api.test/v1", allowWrites, maxRows: 200 };
  const server = createServer(config, new AdsClient({ apiKey: "k", baseUrl: config.baseUrl, fetch: fetch as any, retryBaseMs: 1 }));
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args });
    return { text: r.content[0].text as string, isError: !!r.isError };
  };
  return { client, fetch, call };
}

describe("MCP server", () => {
  it("hides write tools unless enabled", async () => {
    const ro = await connect(false);
    const names = (await ro.client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("get_insights");
    expect(names).not.toContain("set_status");

    const rw = await connect(true);
    expect((await rw.client.listTools()).tools.map((t) => t.name)).toContain("set_status");
  });

  it("lists campaigns as a table with money converted", async () => {
    const { call } = await connect(false);
    const r = await call("list_campaigns");
    expect(r.text).toContain("| cmpn_1 | Fall Sale | active |");
    expect(r.text).toContain("50.00");
    expect(r.text).toContain("ad_in_review");
  });

  it("builds insights query in the API's format", async () => {
    const { call, fetch } = await connect(false);
    const r = await call("get_insights", { level: "campaign", since: "2026-09-01", until: "2026-09-07", segment: "country" });
    expect(r.text).toContain("Fall Sale");
    expect(r.text).not.toContain("hotel_name");
    const url = new URL(fetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("aggregation_level")).toBe("campaign");
    expect(url.searchParams.getAll("fields[]")).toContain("campaign.clicks");
    expect(url.searchParams.getAll("segments[]")).toEqual(["country"]);
    expect(JSON.parse(url.searchParams.get("time_ranges[]")!)).toEqual({ type: "date_range", since: "2026-09-01", until: "2026-09-07" });
  });

  it("account_summary joins campaigns with performance", async () => {
    const { call } = await connect(false);
    const r = await call("account_summary");
    expect(r.text).toContain("Acme");
    expect(r.text).toMatch(/1000 impressions, 25 clicks, 12.50 USD/);
  });

  it("write tools dry-run without confirm", async () => {
    const { call, fetch } = await connect(true);
    const r = await call("set_status", { entity: "campaign", id: "cmpn_1", action: "pause" });
    expect(r.text).toContain("DRY RUN");
    expect(fetch.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("write tools execute with confirm and report before/after", async () => {
    const { call } = await connect(true);
    expect((await call("set_status", { entity: "campaign", id: "cmpn_1", action: "pause", confirm: true })).text).toContain(
      "active -> paused",
    );
    const upd = await call("update_campaign", { campaign_id: "cmpn_1", daily_budget: 80, confirm: true });
    expect(upd.text).toContain("80000000");
  });

  it("get_campaign omits raw JSON unless asked", async () => {
    const { call } = await connect(false);
    expect((await call("get_campaign", { campaign_id: "cmpn_1" })).text).not.toContain("Raw:");
    expect((await call("get_campaign", { campaign_id: "cmpn_1", raw: true })).text).toContain("Raw:");
  });

  it("update_ad_group changing max_bid does not resend a read-only strategy", async () => {
    const { call, fetch } = await connect(true);
    const r = await call("update_ad_group", { ad_group_id: "ag_1", max_bid: 2, confirm: true });
    expect(r.isError).toBe(false);
    const post = fetch.mock.calls.find(([, init]) => init.method === "POST")!;
    expect(JSON.parse(post[1].body as string).bidding_config).toEqual({ billing_event_type: "click", max_bid_micros: 2_000_000 });
  });

  it("upload_image refuses non-image files before touching the network", async () => {
    const { call, fetch } = await connect(true);
    const r = await call("upload_image", { file_path: "C:/Users/me/.ssh/id_rsa", confirm: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Only image files/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns API errors as tool errors, not crashes", async () => {
    const { call } = await connect(false);
    const r = await call("get_ad", { ad_id: "missing" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/404/);
  });
});
