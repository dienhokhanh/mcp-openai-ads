# Contributing

Thanks for helping. Bug reports, new tools and API updates are welcome.

## Setup

```bash
npm install
npm run typecheck && npm test && npm run build
```

## Guidelines

- Check new endpoints against OpenAI's spec: https://developers.openai.com/ads/openapi.json
- Read tools go in `src/tools/read.ts` or `src/tools/insights.ts`. Tools that change anything go in `src/tools/write.ts` and must:
  - be dry-run unless `confirm: true`
  - take money in currency units and convert with `toMicros`
  - create new entities as `paused` by default
- Return compact markdown tables (`table()` in `src/format.ts`) rather than raw JSON where possible.
- Add a test using the mocked API in `test/server.test.ts`.
- Never commit API keys or real account data in fixtures.

## Pull requests

Keep PRs focused, and describe what you tested (unit tests and/or a real account).
