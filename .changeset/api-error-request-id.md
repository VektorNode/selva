---
'@selvajs/selva': patch
---

API error bodies under `/api/*` carry `requestId`, the same value as the `x-request-id` header, so a client that logs only the body can quote it to an operator. `/api/v1` responses default to `Cache-Control: private, no-store`. The team invite form no longer tells header-auth invitees they will set credentials, and `.env.example` no longer says to copy itself into `.env`.
