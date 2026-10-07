---
'@selvajs/platform': minor
'@selvajs/server': minor
'@selvajs/supabase-provider': minor
'@selvajs/selva': minor
---

API tokens on the Supabase provider.

- `@selvajs/platform`: `IAuthProvider.delegatedSession` (`IDelegatedSession`): signs a short-lived session for a user so a token request runs under their row security.
- `@selvajs/server`: `resolveApiToken` signs that session for the owner after re-checking them and puts it in `ctx.adapterContext.sessionToken`. While the provider reports the key broken, every key gets 503 `API_TOKENS_UNAVAILABLE` and `createApiToken` refuses to mint.
- `@selvajs/supabase-provider`: `SupabaseApiTokenStore` and the `api_tokens` migration (RLS: own keys, the org roster for `manage_org_members`; sessions can only set `revoked_at` and never read the hash), plus `audit_events.token_id`. `SupabaseAuthProvider` signs ES256 with `SUPABASE_JWT_SIGNING_KEY` or HS256 with the legacy `SUPABASE_JWT_SECRET`, and checks once that PostgREST accepts the key. **Run `npx selva-supabase` and `npx supabase db push` before updating the app.**
- `@selvajs/selva`: the admin health page reports whether API token sessions work; `.env.example` documents both keys.
