# Enterprise Edition (`ee/`)

Code in this directory is source-visible but covered by a separate
commercial license (see each package's LICENSE), following the same
convention as GitLab, Langfuse, and LiteLLM. **Code outside `ee/` is and
will always remain Apache-2.0.**

Current packages:

- [`adaptive-cache`](./adaptive-cache) — adaptive cache tuning: learns each
  key's traffic rhythm and applies the cheapest cache settings automatically.
  Runtime-gated behind `CACHING_CLOUD=1`; self-hosted builds run fully
  without it.

Reserved for future enterprise features: SSO/SAML, teams & organizations,
RBAC, audit logs.
