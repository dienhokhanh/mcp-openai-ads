# Changelog

## 0.1.0 - 2026-09-29

First release.

- Read tools: account, spend limits, campaigns, ad groups, ads, ad previews, product feeds, conversion setup and events, geo lookup.
- `get_insights` and `account_summary` performance reporting.
- Write tools (opt-in via `OPENAI_ADS_ALLOW_WRITES`): set status, create/update campaign, ad group and ad, and upload image. All writes are dry-run by default.
- Prompts: weekly performance review, find underperformers, diagnose not serving.
