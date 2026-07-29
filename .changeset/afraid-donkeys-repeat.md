---
'@selvajs/supabase-provider': patch
'@selvajs/selva': patch
---

Fix two live defects in `SupabaseAuthProvider`: disabled users could refresh
sessions indefinitely, and `last_login_at` never updated.

**`refreshSession` did not check `disabled`.** `signIn`, `exchangeOAuthCode`, and
`verifyMagicLink` all reject users flagged `user_metadata.disabled === true`;
`refreshSession` did not. This was not a latent gap — the session-refresh
middleware in `hooks.server.ts` calls it on every request where `verifyToken`
fails, so a disabled user's expired access token was silently swapped for a
fresh one on the next request, forever. The `revalidateMs` revocation bound on
`verifyToken` never applied, because that path had already failed by the time
refresh ran. Disabling a user now takes effect within one access-token lifetime
on the refresh path. GoTrue already returns the user alongside the session, so
the check costs no extra round-trip.

**`touchLastLogin` wrote to the wrong schema.** Engine tables live in the `selva`
schema, and every client in `data/client.ts` pins `db: { schema: 'selva' }`. The
auth provider's service-role client was constructed without that option, so it
resolved `user_profiles` against `public` — where the table does not exist.
PostgREST returned a relation-not-found error, and the unchecked `await`
swallowed it, so `last_login_at` silently never updated in any Supabase
deployment. Table access now goes through a schema-pinned client, and a failed
stamp is logged rather than discarded. The write stays best-effort and still
never throws, per the `IAuthProvider.touchLastLogin` contract.

`this.admin` is deliberately left unpinned: it drives `auth.admin.*`, which is
GoTrue's own REST surface and unaffected by the PostgREST schema setting.

`SupabaseAuthProvider.fromEnv` now accepts an optional second `ILogger`
argument, matching `HeaderAuthProvider.fromEnv`. Purely additive — omitting it
keeps the previous `NoopLogger` behavior. `@selvajs/selva` passes its
`lazyLogger` through, so the failure above is actually visible in the app
rather than swallowed.
