---
'@selvajs/selva': minor
---

The v1 API handlers now come from `@selvajs/server`

Handlers, permission guards, the idempotency wire contract, the login rate limiter and paging helpers moved into `@selvajs/server` so the app mounts them instead of owning them. The re-export shells left behind in the app are gone.
