# mcp-openai-ads

[![CI](https://github.com/dienhokhanh/mcp-openai-ads/actions/workflows/ci.yml/badge.svg)](https://github.com/dienhokhanh/mcp-openai-ads/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mcp-openai-ads)](https://www.npmjs.com/package/mcp-openai-ads)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An open-source [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the **OpenAI Ads (ads in ChatGPT) Advertiser API**.

It lets an AI assistant such as Claude Desktop, Claude Code, Cursor or VS Code read your ChatGPT Ads account, report on performance and, if you allow it, manage campaigns, ad groups and ads.

> Community project by [PPC Blog Pro](https://ppcblogpro.com/). Not affiliated with or endorsed by OpenAI.

## Features

- **Read-only by default.** Write tools are only registered when you set `OPENAI_ADS_ALLOW_WRITES=true`.
- **Dry run first.** Every write returns a preview until it is called again with `confirm: true`, and updates report a before/after diff.
- **New entities start paused**, so nothing spends money until you activate it.
- **Money in plain currency units.** You say `daily_budget: 50` and the server converts it to the API's micros.
- **Compact markdown tables**, which keep token use low.
- **Retries with backoff** on 429 and 5xx responses, respecting `Retry-After`. Create calls send an `Idempotency-Key`.

## Tools

| Tool | What it does |
| --- | --- |
| `account_summary` | Account status, campaigns, budgets, serving issues and performance for the last N days |
| `get_insights` | Performance report by account, campaign, ad group or ad. Supports date ranges, daily/hourly/monthly granularity, segments (country, device, platform, product), filters and sort |
| `get_ad_account` | Account details, currency, timezone and brand review status |
| `get_spend_limits` | Daily limit and spend-limit windows, with amounts spent and remaining |
| `list_campaigns` / `get_campaign` | Campaigns with budgets, targeting and serving issues |
| `list_ad_groups` / `get_ad_group` | Bid strategy, max bid and context hints |
| `list_ads` / `get_ad` / `preview_ad` | Creative, review status and a rendered preview |
| `list_product_feeds` | Product feeds and their product and campaign counts |
| `list_conversion_setup` | Pixels and conversion event settings |
| `list_recent_conversion_events` | Recent raw events, to check that a pixel is firing |
| `geo_lookup` | Location ids for targeting |

**Write tools** (require `OPENAI_ADS_ALLOW_WRITES=true`):

| Tool | What it does |
| --- | --- |
| `set_status` | Activate, pause or archive a campaign, ad group or ad |
| `create_campaign` / `update_campaign` | Create a campaign, or change its budget, schedule or targeting |
| `create_ad_group` / `update_ad_group` | Create an ad group, or change its context hints or bidding |
| `create_ad` / `update_ad` | Create an ad, or change its creative (a changed creative goes back to review) |
| `upload_image` | Upload a creative image from a local file or a URL |

**Prompts:** `weekly_performance_review`, `find_underperformers`, `diagnose_not_serving`.

## Setup

### 1. Get an API key

1. Open [OpenAI Ads Manager](https://ads.openai.com), then go to **Settings**.
2. Create an **Advertiser API key**. It is tied to one ad account.

See OpenAI's [Advertiser API overview](https://developers.openai.com/ads/api-overview) for details.

### 2. Add the server to your MCP client

Requires Node.js 20 or later.

**Claude Desktop**: edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "openai-ads": {
      "command": "npx",
      "args": ["-y", "mcp-openai-ads"],
      "env": {
        "OPENAI_ADS_API_KEY": "your-advertiser-api-key"
      }
    }
  }
}
```

On Windows, if `npx` isn't found, use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "mcp-openai-ads"]`.

**Claude Code**:

```bash
claude mcp add openai-ads -e OPENAI_ADS_API_KEY=your-key -- npx -y mcp-openai-ads
```

**Cursor**: use the same JSON as Claude Desktop, in `~/.cursor/mcp.json`.

**VS Code**: add this to `.vscode/mcp.json`:

```json
{
  "servers": {
    "openai-ads": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-openai-ads"],
      "env": { "OPENAI_ADS_API_KEY": "${input:openaiAdsKey}" }
    }
  },
  "inputs": [{ "id": "openaiAdsKey", "type": "promptString", "description": "OpenAI Ads API key", "password": true }]
}
```

### Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `OPENAI_ADS_API_KEY` | (required) | Advertiser API key |
| `OPENAI_ADS_ALLOW_WRITES` | `false` | Set to `true` to enable the write tools |
| `OPENAI_ADS_MAX_ROWS` | `200` | Maximum report rows returned per call |
| `OPENAI_ADS_BASE_URL` | `https://api.ads.openai.com/v1` | Override the API base URL |

## Example prompts

- "Give me a summary of my ChatGPT Ads account for the last 14 days."
- "Show daily clicks and spend for campaign Fall Sale this month, split by device."
- "Which ads have the lowest CTR? Suggest better copy."
- "Why isn't my new campaign serving?"
- (with writes enabled) "Raise the daily budget of Fall Sale to 80 and show me the change before applying it."

## Safety notes

- The API key has full access to its ad account. Keep it in your MCP client's `env` block, never in a repo.
- The server logs only to stderr and never logs the key.
- Leave writes disabled unless you need them. When they are enabled, your AI client should still ask before calling a tool with `confirm: true`.

## Releasing (maintainers)

1. Bump `version` in both `package.json` and `server.json` (a test enforces that they match), and update `CHANGELOG.md`.
2. Commit, then `git tag vX.Y.Z && git push --tags`.
3. The Release workflow publishes to npm and to the [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.dienhokhanh/mcp-openai-ads`.

## Development

```bash
npm install
npm run build
npm test
npm run inspect   # opens the MCP Inspector against dist/index.js
```

To run from source in a client, point it at `node /path/to/repo/dist/index.js`.

The API client is in `src/client.ts`, and tools live in `src/tools/` as `read.ts`, `insights.ts` and `write.ts`. The OpenAI Ads API is new, so if an endpoint changes, please open an issue or PR.

## Author

Built and maintained by [PPC Blog Pro](https://ppcblogpro.com/), which publishes PPC and paid-ads guides, tips and tools.

## License

[MIT](LICENSE)
