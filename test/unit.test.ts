import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AdsApiError, AdsClient, buildQuery } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { money, table, toMicros } from "../src/format.js";
import { compactRows, defaultFields, timeRange } from "../src/tools/insights.js";
import { NAME, VERSION } from "../src/version.js";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("version", () => {
  it("reads name and version from package.json", () => {
    expect(NAME).toBe("mcp-openai-ads");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
  it("keeps server.json in sync with package.json (the MCP Registry rejects mismatches)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const srv = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
    expect(srv.name).toBe(pkg.mcpName);
    expect(srv.version).toBe(pkg.version);
    expect(srv.packages[0]).toMatchObject({ identifier: pkg.name, version: pkg.version });
    expect(srv.description.length).toBeLessThanOrEqual(100);
  });
});

describe("config", () => {
  it("requires an API key", () => {
    expect(() => loadConfig({})).toThrow(/OPENAI_ADS_API_KEY/);
  });
  it("defaults to read-only", () => {
    const c = loadConfig({ OPENAI_ADS_API_KEY: "k" });
    expect(c.allowWrites).toBe(false);
    expect(c.baseUrl).toBe("https://api.ads.openai.com/v1");
    expect(loadConfig({ OPENAI_ADS_API_KEY: "k", OPENAI_ADS_ALLOW_WRITES: "TRUE" }).allowWrites).toBe(true);
  });
});

describe("buildQuery", () => {
  it("uses repeated key[] for arrays and skips empty values", () => {
    const q = buildQuery({ a: 1, b: undefined, c: "", fields: ["x.y", "z"] });
    expect(q).toBe("?a=1&fields%5B%5D=x.y&fields%5B%5D=z");
  });
});

describe("AdsClient", () => {
  it("sends bearer auth and parses JSON", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ id: "acct_1" }));
    const c = new AdsClient({ apiKey: "secret", baseUrl: "https://x/v1", fetch });
    await expect(c.get("/ad_account")).resolves.toEqual({ id: "acct_1" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://x/v1/ad_account");
    expect(init.headers.Authorization).toBe("Bearer secret");
  });

  it("retries 429 then succeeds", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ ok: true }));
    const c = new AdsClient({ apiKey: "k", baseUrl: "https://x", fetch, retryBaseMs: 1 });
    await expect(c.get("/a")).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry 4xx and surfaces a helpful message", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ error: { message: "bad key" } }, 401));
    const c = new AdsClient({ apiKey: "k", baseUrl: "https://x", fetch, retryBaseMs: 1 });
    const err = await c.get("/a").catch((e) => e);
    expect(err).toBeInstanceOf(AdsApiError);
    expect(err.message).toMatch(/401.*API key.*bad key/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("times out hung requests", async () => {
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    const c = new AdsClient({ apiKey: "k", baseUrl: "https://x", fetch: fetch as any, maxRetries: 0, timeoutMs: 20 });
    await expect(c.get("/a")).rejects.toThrow(/timed out/);
  });

  it("caps a huge Retry-After at 30s", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn().mockResolvedValueOnce(json({}, 429, { "retry-after": "3600" })).mockResolvedValueOnce(json({ ok: 1 }));
      const c = new AdsClient({ apiKey: "k", baseUrl: "https://x", fetch });
      const p = c.get("/a");
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(p).resolves.toEqual({ ok: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the offending param on 400", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ error: { message: "invalid value", param: "budget.daily_spend_limit_micros" } }, 400));
    const c = new AdsClient({ apiKey: "k", baseUrl: "https://x", fetch });
    await expect(c.get("/a")).rejects.toThrow(/invalid value \(param: budget.daily_spend_limit_micros\)/);
  });

  it("adds an Idempotency-Key on create", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ id: "c1" }));
    const c = new AdsClient({ apiKey: "k", baseUrl: "https://x", fetch });
    await c.post("/campaigns", { name: "n" }, { idempotent: true });
    expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toMatch(/[0-9a-f-]{36}/);
  });
});

describe("format", () => {
  it("converts micros", () => {
    expect(toMicros(12.5)).toBe(12_500_000);
    expect(money(12_500_000)).toBe("12.50");
    expect(money(undefined)).toBe("");
  });
  it("renders markdown tables and escapes pipes", () => {
    expect(table([{ a: "x|y", b: 1.23456 }])).toBe("| a | b |\n| --- | --- |\n| x\\|y | 1.2346 |");
    expect(table([])).toBe("_No rows._");
  });
});

describe("insights helpers", () => {
  it("builds default fields per level", () => {
    expect(defaultFields("ad", "none")).toEqual(["ad.id", "ad.title", "ad.impressions", "ad.clicks", "ad.spend", "ad.ctr", "ad.cpc", "ad.cpm"]);
    expect(defaultFields("campaign", "daily")[0]).toBe("metadata.readable_time");
  });
  it("computes last_n_days ending yesterday", () => {
    const r = JSON.parse(timeRange({ last_n_days: 7 }, new Date("2026-09-29T12:00:00Z")));
    expect(r).toEqual({ type: "date_range", since: "2026-09-22", until: "2026-09-28" });
  });
  it("uses explicit since/until", () => {
    expect(JSON.parse(timeRange({ since: "2026-01-01", until: "2026-01-31" }))).toEqual({
      type: "date_range",
      since: "2026-01-01",
      until: "2026-01-31",
    });
  });
  it("defaults until to yesterday when only since is given", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(JSON.parse(timeRange({ since: "2026-09-01" }, now)).until).toBe("2026-09-28");
    expect(JSON.parse(timeRange({ since: "2026-09-29" }, now)).until).toBe("2026-09-29");
  });
  it("counts last_n_days back from an explicit until", () => {
    expect(JSON.parse(timeRange({ until: "2026-03-10", last_n_days: 3 }))).toMatchObject({ since: "2026-03-08", until: "2026-03-10" });
  });
  it("rejects since after until", () => {
    expect(() => timeRange({ since: "2026-02-01", until: "2026-01-01" })).toThrow(/on or before/);
  });
  it("drops all-null columns", () => {
    expect(compactRows([{ a: 1, b: null }, { a: 2, b: undefined }])).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
