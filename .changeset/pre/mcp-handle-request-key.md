---
'@selvajs/mcp': minor
---

**Breaking:** `handle(request)` answers as the request's own `Authorization: Bearer` key and never the configured `apiKey`, which only `listen` and `verify` use; a request without a key gets 401 with `WWW-Authenticate: Bearer`. Before, every HTTP caller ran as the server's key. `apiKey` is now optional: a host serving only HTTP drops it, and can stop parsing the bearer itself.
