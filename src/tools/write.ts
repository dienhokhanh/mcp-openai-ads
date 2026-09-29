import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { z } from "zod";
import { toMicros } from "../format.js";
import { WRITE, confirmShape, diff, dryRun, safely, text, type ToolContext } from "./shared.js";

const ENTITY_PATH = { campaign: "campaigns", ad_group: "ad_groups", ad: "ads" } as const;
type Entity = keyof typeof ENTITY_PATH;

const budgetShape = {
  daily_budget: z.number().positive().optional().describe("Daily spend limit in account currency units, e.g. 50 = 50.00."),
  lifetime_budget: z.number().positive().optional().describe("Lifetime spend limit in account currency units."),
};

function budgetBody(a: { daily_budget?: number; lifetime_budget?: number }) {
  if (a.daily_budget === undefined && a.lifetime_budget === undefined) return undefined;
  return {
    ...(a.daily_budget !== undefined && { daily_spend_limit_micros: toMicros(a.daily_budget) }),
    ...(a.lifetime_budget !== undefined && { lifetime_spend_limit_micros: toMicros(a.lifetime_budget) }),
  };
}

const toUnix = (iso?: string) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : undefined);

const targetingShape = {
  countries: z.array(z.string().length(2)).optional().describe("ISO 3166-1 alpha-2 country codes to target, e.g. ['US']."),
  location_ids: z.array(z.string()).optional().describe("Location ids from geo_lookup to include."),
  excluded_countries: z.array(z.string().length(2)).optional(),
  custom_audience_ids: z.array(z.string()).optional(),
};

function targetingBody(a: {
  countries?: string[];
  location_ids?: string[];
  excluded_countries?: string[];
  custom_audience_ids?: string[];
}) {
  const t: Record<string, unknown> = {};
  if (a.countries || a.location_ids)
    t.locations = { ...(a.countries && { countries: a.countries }), ...(a.location_ids && { include: a.location_ids.map((id) => ({ id })) }) };
  if (a.excluded_countries) t.excluded_locations = { countries: a.excluded_countries };
  if (a.custom_audience_ids) t.custom_audiences = { ids: a.custom_audience_ids };
  return Object.keys(t).length ? t : undefined;
}

const creativeShape = z.object({
  type: z.enum(["chat_card", "product_ad_template"]).default("chat_card"),
  title: z.string().min(1),
  body: z.string().min(1),
  target_url: z.string().url().optional(),
  file_id: z.string().optional().describe("Image file id from upload_image."),
  price: z.string().optional(),
});

/** Drops undefined keys so a partial update never sends nulls. */
const clean = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export function registerWriteTools({ server, client }: ToolContext) {
  const exec = async (path: string, body: Record<string, unknown>, confirm?: boolean, create = false) => {
    if (!confirm) return dryRun("POST", path, body);
    const r = await client.post(path, body, { idempotent: create });
    return text(`Done. POST ${path}\n\n` + "```json\n" + JSON.stringify(r, null, 2) + "\n```");
  };

  const update = async (entity: Entity, id: string, body: Record<string, unknown>, confirm?: boolean) => {
    const path = `/${ENTITY_PATH[entity]}/${encodeURIComponent(id)}`;
    const before = await client.get(path);
    if (!confirm) return dryRun("POST", path, body, pick(before, Object.keys(body)));
    const after = await client.post(path, body);
    return text(`Updated ${entity} ${id}.\n\n${diff(before, after, Object.keys(body))}`);
  };

  server.registerTool(
    "set_status",
    {
      title: "Activate / pause / archive",
      description: "Activate, pause or archive a campaign, ad group or ad. Archive cannot be undone. Dry-run unless confirm=true.",
      inputSchema: {
        entity: z.enum(["campaign", "ad_group", "ad"]),
        id: z.string(),
        action: z.enum(["activate", "pause", "archive"]),
        ...confirmShape,
      },
      annotations: { ...WRITE, destructiveHint: true },
    },
    ({ entity, id, action, confirm }) =>
      safely(async () => {
        const base = `/${ENTITY_PATH[entity]}/${encodeURIComponent(id)}`;
        const before = await client.get(base);
        if (!confirm) return dryRun("POST", `${base}/${action}`, undefined, { id, name: before.name, status: before.status });
        const after = await client.post(`${base}/${action}`);
        return text(`${entity} "${before.name}" (${id}): status ${before.status} -> ${after.status}`);
      }),
  );

  server.registerTool(
    "create_campaign",
    {
      title: "Create campaign",
      description: "Create a campaign. Created paused by default so nothing spends until you activate it. Dry-run unless confirm=true.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(["paused", "active"]).default("paused"),
        ...budgetShape,
        objective: z.enum(["reach", "clicks", "conversions"]).optional(),
        bidding_type: z.enum(["impressions", "clicks", "conversions"]).optional(),
        billing_event_type: z.enum(["impression", "click"]).optional(),
        start_time: z.string().optional().describe("ISO 8601 datetime."),
        end_time: z.string().optional().describe("ISO 8601 datetime."),
        mode: z.enum(["product_feed", "business_agent"]).optional(),
        product_feed_id: z.string().optional(),
        conversion_event_setting_ids: z.array(z.string()).optional(),
        ...targetingShape,
        ...confirmShape,
      },
      annotations: WRITE,
    },
    (a) =>
      safely(async () => {
        const budget = budgetBody(a);
        if (!budget) throw new Error("Provide daily_budget and/or lifetime_budget.");
        const body = clean({
          name: a.name,
          description: a.description,
          status: a.status,
          budget,
          objective: a.objective,
          bidding_type: a.bidding_type,
          billing_event_type: a.billing_event_type,
          start_time: toUnix(a.start_time),
          end_time: toUnix(a.end_time),
          mode: a.mode,
          product_feed_id: a.product_feed_id,
          conversion_event_setting_ids: a.conversion_event_setting_ids,
          targeting: targetingBody(a),
        });
        return exec("/campaigns", body, a.confirm, true);
      }),
  );

  server.registerTool(
    "update_campaign",
    {
      title: "Update campaign",
      description: "Update a campaign's name, budget, schedule or targeting. Shows current values in dry-run, and a before/after diff when executed.",
      inputSchema: {
        campaign_id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        ...budgetShape,
        start_time: z.string().optional(),
        end_time: z.string().optional(),
        conversion_event_setting_ids: z.array(z.string()).optional(),
        ...targetingShape,
        ...confirmShape,
      },
      annotations: WRITE,
    },
    (a) =>
      safely(async () => {
        const body = clean({
          name: a.name,
          description: a.description,
          budget: budgetBody(a),
          start_time: toUnix(a.start_time),
          end_time: toUnix(a.end_time),
          conversion_event_setting_ids: a.conversion_event_setting_ids,
          targeting: targetingBody(a),
        });
        if (!Object.keys(body).length) throw new Error("Nothing to update.");
        return update("campaign", a.campaign_id, body, a.confirm);
      }),
  );

  const biddingShape = {
    billing_event_type: z.enum(["impression", "click"]).optional(),
    strategy: z.enum(["fixed_bid", "maximize_clicks", "maximize_conversions"]).optional(),
    max_bid: z.number().positive().optional().describe("Max bid in account currency units."),
  };

  server.registerTool(
    "create_ad_group",
    {
      title: "Create ad group",
      description:
        "Create an ad group in a campaign. context_hints describe the conversation topics where ads should show. Created paused by default. Dry-run unless confirm=true.",
      inputSchema: {
        campaign_id: z.string(),
        name: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(["paused", "active"]).default("paused"),
        context_hints: z.array(z.string()).optional(),
        ...biddingShape,
        ...confirmShape,
      },
      annotations: WRITE,
    },
    (a) =>
      safely(async () => {
        const body = clean({
          campaign_id: a.campaign_id,
          name: a.name,
          description: a.description,
          status: a.status,
          context_hints: a.context_hints,
          bidding_config: clean({
            billing_event_type: a.billing_event_type ?? "click",
            strategy: a.strategy,
            max_bid_micros: a.max_bid !== undefined ? toMicros(a.max_bid) : undefined,
          }),
        });
        return exec("/ad_groups", body, a.confirm, true);
      }),
  );

  server.registerTool(
    "update_ad_group",
    {
      title: "Update ad group",
      description: "Update an ad group's name, context hints or bidding (strategy / max bid). Dry-run unless confirm=true.",
      inputSchema: {
        ad_group_id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        context_hints: z.array(z.string()).optional(),
        ...biddingShape,
        ...confirmShape,
      },
      annotations: WRITE,
    },
    (a) =>
      safely(async () => {
        const bidChange = a.strategy !== undefined || a.max_bid !== undefined || a.billing_event_type !== undefined;
        let bidding_config: Record<string, unknown> | undefined;
        if (bidChange) {
          // billing_event_type is required on update, so carry over the current value. strategy is only sent
          // when changed: reads can return "automated_bid", which the update endpoint rejects.
          const current = await client.get(`/ad_groups/${encodeURIComponent(a.ad_group_id)}`);
          const cur = current.bidding_config ?? {};
          bidding_config = clean({
            billing_event_type: a.billing_event_type ?? cur.billing_event_type,
            strategy: a.strategy,
            max_bid_micros: a.max_bid !== undefined ? toMicros(a.max_bid) : cur.max_bid_micros,
            custom_audience_bid_multipliers: cur.custom_audience_bid_multipliers,
          });
        }
        const body = clean({ name: a.name, description: a.description, context_hints: a.context_hints, bidding_config });
        if (!Object.keys(body).length) throw new Error("Nothing to update.");
        return update("ad_group", a.ad_group_id, body, a.confirm);
      }),
  );

  server.registerTool(
    "create_ad",
    {
      title: "Create ad",
      description: "Create an ad in an ad group. Ads go through review before serving. Created paused by default. Dry-run unless confirm=true.",
      inputSchema: {
        ad_group_id: z.string(),
        name: z.string().min(1),
        status: z.enum(["paused", "active"]).default("paused"),
        creative: creativeShape,
        ...confirmShape,
      },
      annotations: WRITE,
    },
    (a) =>
      safely(async () =>
        exec("/ads", { ad_group_id: a.ad_group_id, name: a.name, status: a.status, creative: clean(a.creative) }, a.confirm, true),
      ),
  );

  server.registerTool(
    "update_ad",
    {
      title: "Update ad",
      description: "Update an ad's name or creative. Changing the creative sends the ad back to review. Dry-run unless confirm=true.",
      inputSchema: {
        ad_id: z.string(),
        name: z.string().optional(),
        creative: creativeShape.optional(),
        ...confirmShape,
      },
      annotations: WRITE,
    },
    (a) =>
      safely(async () => {
        const body = clean({ name: a.name, creative: a.creative ? clean(a.creative) : undefined });
        if (!Object.keys(body).length) throw new Error("Nothing to update.");
        return update("ad", a.ad_id, body, a.confirm);
      }),
  );

  server.registerTool(
    "upload_image",
    {
      title: "Upload image",
      description:
        "Upload an ad image (min 640x640) from a local file path or a public URL. Returns a file_id to use in create_ad / update_ad creative.",
      inputSchema: {
        file_path: z.string().optional().describe("Absolute path to a local PNG/JPEG/WebP file."),
        image_url: z.string().url().optional(),
        ...confirmShape,
      },
      annotations: WRITE,
    },
    (a) =>
      safely(async () => {
        if (!a.file_path === !a.image_url) throw new Error("Provide exactly one of file_path or image_url.");
        // Only image files may leave the machine: a prompt-injected model must not be able to upload arbitrary files.
        const mime = a.file_path ? MIME[extname(a.file_path).toLowerCase()] : undefined;
        if (a.file_path) {
          if (!mime) throw new Error(`Only image files can be uploaded (${Object.keys(MIME).join(", ")}).`);
          const size = (await stat(a.file_path)).size;
          if (size > MAX_UPLOAD_BYTES) throw new Error(`Image is ${(size / 1e6).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1e6} MB.`);
        }
        if (!a.confirm) return dryRun("POST", "/upload", a.image_url ? { image_url: a.image_url } : { file: a.file_path });
        let r: any;
        if (a.image_url) r = await client.post("/upload", { image_url: a.image_url });
        else {
          const buf = await readFile(a.file_path!);
          const form = new FormData();
          form.append("file", new Blob([buf], { type: mime }), basename(a.file_path!));
          r = await client.postForm("/upload", form);
        }
        return text(`Uploaded. file_id: ${r.file_id}`);
      }),
  );
}

const MAX_UPLOAD_BYTES = 10_000_000;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

function pick(o: Record<string, any>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o?.[k]]));
}
