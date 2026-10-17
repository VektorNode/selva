---
'@selvajs/server': minor
'@selvajs/platform': minor
'@selvajs/local-provider': patch
'@selvajs/supabase-provider': minor
---

API tokens stay inside what they were minted for:

- **Breaking:** `resolveApiToken` re-checks on every request that the owner may still hold keys. Without a host `mayHoldApiTokens` policy that means `manage_api_tokens`, so withdrawing the permission turns existing keys off (403 `API_TOKEN_HOLDER_REFUSED`). `ResolveApiTokenDeps.data` now needs `permissions`. `canHoldApiTokens(ctx, policy?)` in `@selvajs/server/tokens` is the one place that default lives.
- Moving a definition with `PATCH /definitions/{guid}` needs `write` on the destination project too, so a project-scoped key can't carry a definition out of its project.
- A scope refusal on a definition outside the key's org reads exactly like one on a missing guid: the 403 detail no longer confirms it exists or names its project.
- Supabase: a new migration stops an owner from writing `revoked_at = null` to revive a revoked key. Run `selva-supabase` to sync it.
- Supabase: the delegated session's lifetime is configurable (`delegatedSessionTtlSeconds` on `SupabaseAuthProvider`, or the third argument of `fromEnv`), so a long solve doesn't end with an expired JWT.
- Local provider: token writes are serialized, so a `lastUsedAt` write racing a revoke can no longer restore the key, and concurrent mints no longer lose one.
- `listOrgApiTokens` and `canManageApiTokenRoster` in `@selvajs/server/handlers` back both the list endpoint and a host's token page.
- **Breaking:** `read_all_org_projects` is removed. Nothing enforced it yet.
- **Breaking:** `requestFingerprint` takes the request `URL` instead of a path string, so every caller hashes the query too. `idempotencyKey`, `toStoredResponse`, `fromStoredResponse`, `IDEMPOTENCY_REPLAYED_HEADER` and `StoredResponse` are no longer exported from `@selvajs/server/compute`.
