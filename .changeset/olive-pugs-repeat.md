---
'@selvajs/platform': minor
'@selvajs/supabase-provider': minor
---

Add `ISessionRefresh` — session refresh + server-side revoke

Session lifecycle now has its own capability, `IAuthProvider.sessionRefresh`,
holding `refreshSession` and a new `revokeSession`.

**Why it moved off `IOAuthAuth`.** Refresh and revoke are properties of a
_session_, not of OAuth. A deployment that brokers no OAuth
(`oauth.listProviders()` → `[]`) still needs to revoke on logout, and
previously had to reach into an OAuth capability whose stated precondition it
did not meet — which worked only because the Supabase adapter constructs its
OAuth surface unconditionally.

**`revokeSession` is new behaviour, not a move.** Nothing in the tree could
invalidate a session server-side. Logout deleted the cookie and the JWT stayed
valid until natural expiry, so a copy captured elsewhere kept working after the
user believed they had signed out. The Supabase adapter implements it via
GoTrue's `admin.signOut(jwt, 'global')`, signing out every session for that
user rather than only the one the token names.

It is best-effort and idempotent: revoking an already-revoked, expired, or
unknown token returns `true` (the desired end state holds), and it never
throws — a failed revoke must not stop a user from logging out. `false` means
the session may still be live.

`IOAuthAuth.refreshSession` is **deprecated but still works**, delegating to the
new surface for one release. Migrate callers to
`auth.sessionRefresh?.refreshSession(...)`; it will be removed in the next minor.

Also corrects `disableUser`'s doc comment, which claimed "Sessions become
invalid". Disabling sets the metadata flag; adapters verifying tokens locally
keep accepting an already-issued access token until their next revalidation
(the Supabase adapter bounds this by `revalidateMs`, default 60s). Callers
needing immediate cutoff should also call `sessionRefresh.revokeSession`.
