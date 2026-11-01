---
'@selvajs/platform': minor
'@selvajs/local-provider': patch
'@selvajs/supabase-provider': minor
'@selvajs/server': patch
---

Stored compute ciphertext can no longer be replayed to decrypt someone else's API key.

- `encryptSecret` and `decryptSecret` take an optional `aad`. With it, `encryptSecret` writes an `enc:v2:` envelope bound to that value. `enc:v1:` envelopes still read, and a store rewrites them as `v2` the next time their server is saved.
- Both compute stores bind each key to its server id and refuse a value that's already an envelope, instead of passing it through.
- `validateIncomingServers` rejects an `apiKey` that looks like an envelope, on both the admin and org compute routes.
- On Supabase, sessions can no longer select `compute_servers.api_key`. The store reads keys with the service role, and only for servers the session's own read can see.

Apply this release's migration: run `npx selva-supabase`, then `npx supabase db push`. Host apps that select `api_key` with a session JWT have to move that read behind the service role.
