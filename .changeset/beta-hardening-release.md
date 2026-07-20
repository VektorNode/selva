---
'@selvajs/server': minor
'@selvajs/ui': minor
'@selvajs/compute': minor
'@selvajs/selva': minor
---

Beta release covering the pre-open-source hardening pass and follow-on work across the app stack:

- **Audit/erasure**: user-deletion erasure now scrubs `audit_events`, `invites`, and redacts embedded emails from surviving `invite.created` payloads; `solve_metrics` is anonymized rather than cascaded.
- **Logging**: structured logging via Pino with request-ID correlation, replacing ad hoc console logging across the server.
- **Caching**: durable L2 solve-result cache with a memory backend, client-side result memoization (LRU), warm-client caching per server, backpressure controls, and definition byte caching; response wire-size tracking feeds caching efficiency metrics.
- **Definitions**: extracted definitions server slice (`@selvajs/server/definitions`) with schema-version-aware extraction/caching and hardened schema-version parsing/error handling.
- **Tests**: new e2e core-loop tests against a fake compute server, and per-file test isolation to fix flaky mocks.
