# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's **Report a vulnerability** (private security advisory) on this repository. We aim to respond within 7 days.

## Handling API keys

- An OpenAI Ads Advertiser API key grants full access to its ad account, including spending money.
- Store it only in your MCP client's `env` configuration or a secret manager. Never put it in a repo, issue or log.
- If a key leaks, revoke it immediately in Ads Manager > Settings.
- Leave `OPENAI_ADS_ALLOW_WRITES` unset unless you need write access.
