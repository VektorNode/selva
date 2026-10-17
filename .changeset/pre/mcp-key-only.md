---
'@selvajs/mcp': minor
---

- `handle` answers 401 to a bearer that isn't a Selva API key (`selva_…`), and API calls send `credentials: 'omit'`. A host whose `fetch` forwards the incoming request's cookies can no longer run tools as the browser session.
- `handle(request, { fetch })` takes a per-request `fetch`, so a host can build the server once and still use a request-bound fetch.
- `idempotentHint` is set only when every call is a GET, PUT or DELETE. Accepting an `Idempotency-Key` makes a retry safe, not a repeat tool call.
