/** Helpers that turn API payloads into compact, LLM-friendly text. */

export const MICROS = 1_000_000;

export const toMicros = (amount: number) => Math.round(amount * MICROS);

export function money(micros: number | null | undefined): string {
  return typeof micros === "number" ? (micros / MICROS).toFixed(2) : "";
}

export function unixToIso(ts: number | null | undefined): string {
  if (typeof ts !== "number" || ts <= 0) return "";
  return new Date(ts * 1000).toISOString().replace(".000Z", "Z");
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
  if (typeof v === "object") return JSON.stringify(v).replace(/\|/g, "\\|");
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Markdown table. Columns default to the union of keys, in first-seen order. */
export function table(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return "_No rows._";
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}

export interface Page<T> {
  data: T[];
  has_more?: boolean;
  first_id?: string | null;
  last_id?: string | null;
}

export function pageFooter(page: Page<unknown>): string {
  if (!page.has_more) return "";
  return `\n\nMore results available. Call again with after="${page.last_id}" for the next page.`;
}

/** Joins serving issue codes, e.g. "campaign_budget_exhausted, ad_in_review". */
export function issues(list: Array<{ code: string }> | undefined): string {
  return (list ?? []).map((i) => i.code).join(", ");
}
