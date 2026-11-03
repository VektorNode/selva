# Offboarding: one sign-in rule for every provider

**Tracked in: unfiled.**

When someone leaves, the company disables them in its identity provider and expects Selva to
follow: no more browser access, and no working API tokens. That has to hold on header-auth, on
Supabase and on any provider added later, without each provider growing rules of its own. The
evidence behind the decisions below is in
[directory-offboarding-validation.md](./directory-offboarding-validation.md).

## Decisions

### The contract a provider meets

Every rule here reads three things `IAuthProvider` already has to supply:

- **`getUser().disabled`**: the person is blocked.
- **`getUser().lastLoginAt`**: the last time the identity provider let this person in. A session
  refresh never moves it.
  - Header-auth: a proxied visit, because the proxy re-checks the identity provider on its own
    refresh.
  - Supabase: `last_sign_in_at`, which GoTrue sets in `IssueRefreshToken` and never on the refresh
    grant.
  - Local: a password sign-in.
- **`disableUser(id)`**: block them.

A provider must also never hand an existing user id to a different person. How it recognises a
person is the one thing that can't be shared (see Per provider).

The `lastLoginAt` meaning goes on `AuthUser` in `packages/platform/src/auth/types.ts`. The shared
suite (`packages/platform/src/testing/suites/authProviderSuite.ts`) pins it: a refresh doesn't move
`lastLoginAt`, and a disabled user can't refresh. Local and Supabase already run that suite;
header-auth joins it. If a provider moved `lastLoginAt` on refresh, every rule below would quietly
stop protecting anyone, so the test is the point.

### The rules live once, in `@selvajs/server`

1. **Disabling refuses sign-in and revokes every key.** This exists today
   (`/api/admin/users/[id]/disable`).
2. **One sign-in lasts `SIGN_IN_MAX_AGE_DAYS`.** This is the built
   `API_TOKEN_SIGN_IN_WINDOW_DAYS`, renamed before it ships and no longer limited to header-auth.
   - **API tokens:** a key whose owner's `lastLoginAt` is older than the window is refused, and
     revoked with a new reason, `sign_in_lapsed`. Revoking matters: refused-only keys come back to
     life when a reused UPN or email lets someone else move the same row's `lastLoginAt`.
   - **Browser sessions Selva owns** (local, Supabase, later OIDC providers): the shared session
     refresher refuses a refresh past the window. Sessions the proxy owns (header-auth) are bounded
     by the proxy's own settings.
   - **New keys:** the OAuth consent page and Team → API tokens require a sign-in within the
     window, and otherwise send the person to sign in again first. Without this, a Supabase user
     with a long-lived session would get a plugin key that is refused the moment it's issued.
   - **Off unless set.** A key behind an integration stops too when its human owner stays away.
     Service accounts ([service-accounts.md](./service-accounts.md)) are the answer for those, and
     they are exempt.
   - **A malformed value refuses to boot,** and the boot log states the window in effect. A typo
     must not switch the protection off silently.
   - **A `lastLoginAt` more than a minute in the future counts as lapsed.** Otherwise clock skew or
     a restored file pins the window open.
   - **A lapsed key gets the same response as an invalid one.** The real reason is logged with the
     token id only, so a leaked key doesn't reveal that its owner has been away.
   - **The rename** touches `.env.example`, its template, the Entra guide and the changeset in one
     change.
3. **Org-member routes need a browser session**, like invites and token management already do. A
   surviving owner key must not demote co-owners or clear admins' permissions.
4. **Disabling or removing someone revokes the invites they sent.** Accepting an invite re-checks
   that the inviter is still enabled and a member. In proxy mode, the visitor's proxied identity
   must equal `invite.email`.

### Per provider: only what can't be shared

- **Header-auth.**
  - The proxy's session settings live in the Entra guide: `cookie_refresh`, `cookie_expire`,
    oauth2-proxy 7.15.5 or later, Caddy 2.11.2 or later.
  - Identity: the email fallback stops preferring the header-written `email` column over an exact
    UPN row, and only a row that has never signed in may be adopted by email.
  - Object-ID matching comes later. `X-Auth-Request-User` is Entra's per-app `sub`, so the object
    ID needs oauth2-proxy's alpha-config claim headers.
- **Supabase.** Nothing beyond the shared rules. Its guide gets a "When someone leaves" section.
  Still to check: whether Supabase's Azure provider links a sign-in to an existing account by
  email, which would let a reused address land on a departed person's account.
- **Local.** Nothing.

A new provider implements the contract, passes the shared suite and, if it is proxy-based, adds a
guide section on the proxy's session settings.

### What the customer's IT does

Nothing. oauth2-proxy's refresh works without an Entra change, because Microsoft grants
`offline_access` along with any other delegated permission. The one Entra chore is rotating the
client secret before it expires.

### Later, if a customer's IT wants automation

**SCIM** works with any identity provider (Entra, Okta) and calls the same disable function as the
admin route. Before it can, that function needs:

- an explicit system actor for audit events;
- a rule for "the target is the last instance admin" that logs and skips, so it never answers 409
  into a retry loop;
- an `enableUser` for `active: true`.

The endpoint itself needs a secret of its own (not a `selva_` key), a rate limit and a
constant-time compare. It also depends on an immutable external id on every row, set by an admin
backfill rather than filled on first match.

The **Graph sweep** is Entra-only and isn't planned.

## Rejected

- **A Graph check on every token request.** It puts Microsoft's API in the path of every upload; an
  outage either blocks requests or waves them through.
- **Shorter API tokens as the fix.** Everyone would sign in more often. The window affects only the
  people who need it.
- **Entra-issued tokens for the plugin.** That ties the plugin to one identity provider and leaves
  Selva with two token systems.
- **Supabase's "Time-box user sessions" as the browser bound.** It's Pro-only on hosted Supabase,
  and it's per-provider config. The shared refresher bounds every session Selva owns.
- **Filling an external id on the first UPN match.** It reopens the takeover for every dormant row:
  the newcomer with the reused UPN fills in their own id.
- **Deleting the Selva user when the identity provider deletes them.** Erasure is the operator's
  decision.

## Tests that must pin it

- **Provider suite:** a refresh doesn't move `lastLoginAt`; a disabled user can't refresh;
  header-auth runs the suite.
- **Window:**
  - a key whose owner signed in outside the window gets 401 and is revoked with `sign_in_lapsed`;
    inside the window it works;
  - an owner who never signed in, or whose stamp is in the future, counts as lapsed;
  - a malformed value refuses to boot;
  - the lapsed response body equals the invalid-key body.
- **Session refresher:** a Selva-owned session can't be refreshed past the window.
- **Consent and mint:** a stale sign-in is sent to sign in again; a fresh one proceeds.
- **Org members:** a token context gets 403 on changing or removing a member.
- **Invites:** disabling the inviter revokes their pending invites; a proxy-mode accept refuses a
  visitor whose identity differs from `invite.email`.
- **Header-auth identity:** an exact UPN row wins over a header-written email match.
