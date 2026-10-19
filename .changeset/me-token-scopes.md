---
'@selvajs/server': minor
---

`GET /api/v1/me` adds `apiToken: { id, scopes }` when the caller is an API token, so a client can tell what its key may do.
