export interface Config {
  apiKey: string;
  baseUrl: string;
  allowWrites: boolean;
  maxRows: number;
}

const truthy = (v: string | undefined) => ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase());

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.OPENAI_ADS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_ADS_API_KEY is not set. Create an Advertiser API key in Ads Manager > Settings (https://ads.openai.com/settings) and pass it via the env block of your MCP client config.",
    );
  }
  const maxRows = Number(env.OPENAI_ADS_MAX_ROWS ?? 200);
  return {
    apiKey,
    baseUrl: (env.OPENAI_ADS_BASE_URL ?? "https://api.ads.openai.com/v1").replace(/\/+$/, ""),
    allowWrites: truthy(env.OPENAI_ADS_ALLOW_WRITES),
    maxRows: Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 200,
  };
}
