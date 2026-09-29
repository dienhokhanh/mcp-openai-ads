import { randomUUID } from "node:crypto";
import { NAME, VERSION } from "./version.js";

export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;
export type Query = Record<string, QueryValue>;

export class AdsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "AdsApiError";
  }
}

export interface ClientOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  maxRetries?: number;
  /** Base backoff in ms; overridable so tests run instantly. */
  retryBaseMs?: number;
  /** Per-attempt request timeout in ms. */
  timeoutMs?: number;
}

const USER_AGENT = `${NAME}/${VERSION}`;
/** Never let a server-sent Retry-After stall a tool call longer than this. */
const MAX_RETRY_WAIT_MS = 30_000;

/** Array params use the API's repeated `key[]=value` form. */
export function buildQuery(query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) for (const v of value) params.append(`${key}[]`, String(v));
    else params.append(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export class AdsClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly opts: ClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  get<T = any>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  /** Creates send an Idempotency-Key so a retried request cannot create duplicates. */
  post<T = any>(path: string, body?: unknown, opts: { idempotent?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.idempotent) headers["Idempotency-Key"] = randomUUID();
    return this.request<T>("POST", path, { body, headers });
  }

  postForm<T = any>(path: string, form: FormData): Promise<T> {
    return this.request<T>("POST", path, { form });
  }

  private async request<T>(
    method: string,
    path: string,
    init: { query?: Query; body?: unknown; form?: FormData; headers?: Record<string, string> },
  ): Promise<T> {
    const url = `${this.opts.baseUrl}${path}${buildQuery(init.query)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...init.headers,
    };
    let body: BodyInit | undefined;
    if (init.form) body = init.form;
    else if (method === "POST") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body ?? {});
    }

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await sleep(this.backoff(attempt));
          continue;
        }
        const e = err as Error;
        const reason = e.name === "TimeoutError" ? `request timed out after ${this.timeoutMs / 1000}s` : e.message;
        throw new AdsApiError(0, `Network error calling OpenAI Ads API: ${reason}`);
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoff(attempt);
        await sleep(Math.min(wait, MAX_RETRY_WAIT_MS));
        continue;
      }

      const text = await res.text();
      let data: any = undefined;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!res.ok) throw new AdsApiError(res.status, describeError(res.status, data), data);
      return data as T;
    }
  }

  private backoff(attempt: number) {
    return this.retryBaseMs * 2 ** attempt + Math.random() * this.retryBaseMs;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describeError(status: number, data: any): string {
  let apiMsg =
    (typeof data === "object" && data && (data.error?.message ?? data.message ?? data.detail)) ||
    (typeof data === "string" ? data.slice(0, 500) : "");
  if (typeof apiMsg !== "string") apiMsg = JSON.stringify(apiMsg).slice(0, 500);
  // Naming the offending field lets the model fix its own arguments on a 400.
  const param = typeof data === "object" && data ? (data.error?.param ?? data.param) : undefined;
  if (param) apiMsg += ` (param: ${param})`;
  const hint: Record<number, string> = {
    400: "Invalid request",
    401: "Invalid or missing API key. Check OPENAI_ADS_API_KEY (Ads Manager > Settings)",
    403: "The API key does not have access to this resource or ad account",
    404: "Resource not found. Check the id",
    429: "Rate limited by the OpenAI Ads API (600 req/min per endpoint, 1,200 req/min overall)",
  };
  return [`OpenAI Ads API error ${status}`, hint[status], apiMsg].filter(Boolean).join(": ");
}
