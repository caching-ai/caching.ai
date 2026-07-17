# Security Policy

Caching.ai handles provider API keys and sits in the request path of
production AI traffic — we take reports here seriously and respond fast.

## Reporting a vulnerability

- **Preferred**: GitHub → Security tab → "Report a vulnerability"
  (private vulnerability reporting is enabled on this repository).
- Or email **support@caching.ai**.

Please include reproduction steps and impact. Do not open a public issue for
security reports, and do not test against the hosted service with keys or
data you don't own.

We aim to acknowledge within 48 hours and to ship a fix or mitigation for
confirmed critical issues within 7 days.

## Scope notes

- Provider keys are encrypted at rest with AES-256-GCM; prompt/response
  bodies are never stored (opt-in keep-alive stores an encrypted prefix —
  by design, disclosed on the toggle and in the privacy policy).
- Reports about the hosted service at caching.ai are equally welcome through
  the same channels.
