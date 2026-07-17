# Contributing to Caching.ai

Thanks for helping keep everyone's AI cache warm. 🔥

## Ground rules

- **License**: contributions are accepted under the repository's
  [Apache-2.0 license](LICENSE).
- **DCO**: we use the [Developer Certificate of Origin](https://developercertificate.org/)
  instead of a CLA. Sign your commits with `git commit -s` (adds a
  `Signed-off-by:` trailer certifying you have the right to submit the code).
- **Scope**: the proxy must stay byte-transparent. Any change that buffers a
  stream, mutates a response, or stores prompt/response bodies will be
  rejected regardless of how useful it is.

## Getting started

```bash
pnpm install
# the proxy tests expect three pre-created local Postgres 16 databases:
createdb caching_ai_test && createdb caching_ai_test2 && createdb caching_ai_test3
cd apps/proxy && pnpm test
cd apps/web && pnpm dev
```

Override the connection strings with `TEST_DATABASE_URL` (and
`TEST_DATABASE_URL_PAYMENTS` for the payments suite) if your Postgres isn't
on the default socket.

- Tests live in `apps/proxy/test/` (node:test). Every behavior change needs a
  test that fails without it.
- Provider request/response shapes are mocked in `test/mock-providers.ts` —
  never call real provider APIs from tests.
- Migrations are forward-only SQL files in `packages/shared/migrations/`
  (`NNN_name.sql`). Never edit an applied migration; add a new one.

## Pull requests

1. Fork, branch from `main`, keep PRs focused on one change.
2. `pnpm test` green + `pnpm exec tsc --noEmit` clean in the packages you touched.
3. Describe the failure mode you're fixing (or the traffic pattern the feature
   serves) — not just the diff.

## Reporting bugs

Open a GitHub issue with the provider, model, whether streaming was on, and
the smallest request shape that reproduces it. **Never paste API keys or
prompt contents.** For anything security-sensitive, see [SECURITY.md](SECURITY.md).
