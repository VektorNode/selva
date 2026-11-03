# Validation: directory-offboarding

Validates [directory-offboarding.md](./directory-offboarding.md), the built sign-in window
(`API_TOKEN_SIGN_IN_WINDOW_DAYS`, `packages/server/src/http/api-token.ts`), and the Entra guide
changes ([header-auth-entra.md](../../docs/self-hosting/providers/header-auth-entra.md),
[signing-in-from-apps.md](../../docs/packages/build/signing-in-from-apps.md)).

**How it was checked.** Path, line and config claims went to one cheap pass, and a sample of its
confirmations was re-read by hand. Code-behaviour claims got a separate read. The plan's proposals
were cross-checked against each other and against the archived plans. Two independent hunts, one on
token and offboarding paths and one on the Entra deployment guide, never saw the plan. Every
"reproduced" finding was re-run from its script by a second agent. The baseline was green:
`@selvajs/server`, `@selvajs/selva`, `@selvajs/plugin-ui` and `Selva.Tests` all pass, type-check is
clean, and lint has no errors.

**Not verified here:** anything live. There was no Entra tenant, oauth2-proxy, Caddy or Rhino to
run against. oauth2-proxy behaviour comes from its source and changelog, Entra behaviour from
Microsoft's docs. Whether a disabled user's refresh returns `invalid_grant` rests on third-party
reports plus Microsoft's generic error reference. The customer's tenant settings and existing
integration keys are unknown.

## 1. Corrections

- **"Identity is the UPN": partly.** `identifyFromHeaders` looks a user up by UPN, then falls back
  to email (`HeaderAuthProvider.ts:176-182`). `findByEmail` matches the stored `email` column,
  which proxy headers write through `syncFromHeaders`, before it matches a row by UPN
  (`users.ts:118`). So a reused email address lands on the departed person's row as well, even when
  an admin has allowlisted a fresh row for it (reproduced). Microsoft also says `preferred_username`
  is mutable and must not be used for authorization. A UPN rename locks the person out and leaves
  the old row enabled for whoever gets that UPN next. `rebindUpn` has no caller.
- **`offline_access` "for one admin consent": wrong.** Microsoft: "If any delegated permission is
  granted, offline_access is implicitly granted"
  ([scopes-oidc](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc)).
  oauth2-proxy already requests `openid email profile`. In a tenant where people sign in today,
  adding `offline_access` and `cookie_refresh` needs nothing from IT. The guide's Part 1 step 4
  ("Optional, needs an admin") and the Part 3 warning about consent prompts and lockout are wrong
  for the same reason.
- **Minimum oauth2-proxy v7.15.2: partly.** It is right for ending a session on a refused refresh
  (#3333). But 7.15.2 to 7.15.4 have
  [GHSA-hhqp-vx7f-5c6m](https://github.com/oauth2-proxy/oauth2-proxy/security/advisories/GHSA-hhqp-vx7f-5c6m):
  a callback with a bad CSRF cookie logs the whole request, session cookie included. The floor is
  v7.15.5.
- **"Check which claim fills `X-Auth-Request-User`": resolved, and the guide is wrong.**
  oauth2-proxy fills it from `sub` (`providers/provider_data.go`, `oidcUserClaim = "sub"`, "not
  currently user configurable"). Entra's `sub` is pairwise per application. It is not the object
  ID, so the guide's "`X-Auth-Request-User` is an opaque OID" (`header-auth-entra.md:173`) is
  wrong, and so is the `.env.example` hint to read the UPN from it. Getting `oid` needs
  oauth2-proxy's alpha-config claim headers (not tried).
- **"Okta and Google Workspace speak SCIM too": partly.** Okta does. Google Workspace provisions
  custom apps over SCIM only as a limited beta, for SAML apps only.
- **Presence row, "within the window plus `cookie_expire`": partly.** Until the proxy cookie runs
  out, a person disabled in Entra still passes the proxy. In that time they can mint Team keys (up
  to 180 days) and approve OAuth keys, and each request moves `lastLoginAt` forward. With the window
  on, the bound holds from their last cookie use. With it off (the default), new keys live their
  whole lifetime.
- **"Plain 401, so the plugin and MCP clients drop the key": partly.** The plugin forgets the key
  and asks the user to sign in. MCP caches a key's grants for 60 s (`packages/mcp/src/server.ts`,
  `GRANTS_TTL_MS`). Inside that window a lapsed or revoked key gets a tool error in a 200, not a 401.
- **"The dropped key isn't revoked. It works again only if its owner comes back": confirmed, and
  worse than stated.** If Entra reassigns the UPN, the new holder's first proxied visit makes the
  departed person's lapsed key work again (reproduced).
- **One core disable function: gap.** The admin route needs a human actor:
  `requireCanRemoveInstanceAdmin`, `setUserPlatformPermissions` and `actorFrom(locals.ctx)`.
  `IAuthProvider` has `disableUser` but no enable (`interface.ts:330`), and SCIM `active: true`
  needs one. The core needs an explicit system actor, a rule for "target is the last instance
  admin" that never answers 409 into a retry loop, and an `enableUser`.
- **Object-ID matching, "fill it on first match": conflict.** A row with no `externalId` yet is
  filled by whoever matches it first by UPN. That is the reused-UPN newcomer for any dormant row, so
  the fallback reopens the hole it closes. It also writes stored identity from a proxy header, which
  `users.ts:75-85` forbids. The email path would skip the check entirely. It needs an admin
  backfill, a strict mode, and the check on every lookup path.
- **Graph sweep: gap.** It can only query rows that have an object ID. A lookup by UPN returns the
  new holder's enabled account.
- **Docs, "Selva matches header-auth users by UPN": partly.** It is UPN, then email (see the first
  correction).
- **Two agent claims, corrected here.** First: "turning the window on cuts everyone who hasn't
  visited since the feature went in" is wrong. `lastLoginAt` was already written on every proxied
  visit, so only people with no visit within the window lose their keys. Second: "`touchLastLogin`
  is unthrottled" is wrong. The store debounces it to 60 s (`users.ts:33`).

## 2. Confirmed

- Requests carrying `Bearer selva_*` skip `forward_auth`, and `@mcpPublic` includes
  `/oauth/token` (guide Caddyfile).
- Disabling a user revokes their tokens in every org (`disable/+server.ts:73-77`). Removing a member
  revokes their tokens in that org (`orgMembers.ts:285`). Revocation is one-way on both stores.
- A disabled user is refused on their next request. Nothing caches identity across requests; the
  holder cache skips only the holder check.
- `lastLoginAt` moves only on proxied requests (`HeaderAuthProvider.ts:264`). Token requests,
  `/oauth/token` and `/mcp` never move it, because `hooks.server.ts` resolves the token first and
  returns.
- Only `HeaderAuthProvider` sets `proxyAuth`. The local provider writes `lastLoginAt` only at
  password sign-in.
- The resolver's 401 carries `WWW-Authenticate: Bearer error="invalid_token"`. The plugin maps it
  to `SignInEnded`, which calls `Forget` (`SelvaApiClient.cs:230`,
  `SelvaUploadCoordinator.cs:216,313,447`).
- The SCIM and Entra facts hold, with sources: a cycle about every 40 minutes; `active: false` for
  disabled, soft-deleted or unassigned users (given the `IsSoftDeleted` mapping, and with "skip out
  of scope deletions" off); `DELETE` after a hard delete; `oid` only with the `profile` scope; `sub`
  pairwise; and a Cloud Application Administrator can't consent to Graph application permissions.

## 3. New findings

### High

- **An org owner's `write:all` key can rewrite membership.** At `orgMembers.ts:131` and `:215`,
  `updateOrgMember` and `removeOrgMember` have no session guard; invites (`invites.ts:87`) and token
  management (`apiTokens.ts:49`) do. A leaver's surviving key can demote co-owners and clear admins'
  permissions. After that, nobody in the org can remove the leaver or revoke their keys; only an
  instance admin can. _Reproduced._ Fix: add the same session guard to both handlers.
- **The sign-in window fails open.** At `api-token.ts:218` it is off unless set. A typo like `7d`
  or `1w` logs a warning and leaves it off; `0.5` is floored to 0 with no warning. Nothing at boot
  says whether it is active. If the runbook is forgotten, a leaver keeps keys of up to 180 days.
  _Reproduced._ Fix: on by default for proxy-auth providers, with `0` to opt out. Refuse to boot on
  an unparseable value, and log the effective window at boot.
- **Lapsed keys are refused, never revoked.** Together with UPN reuse, the departed person's key
  comes back to life (see the corrections). _Reproduced._ Fix: revoke at lapse, with a new revoke
  reason (check the Supabase constraint on `reason`).
- **The leaver keeps the browser until the proxy cookie expires, and can mint keys in that time.**
  `header-auth-entra.md` sets 12 h without refresh. With refresh, which needs no admin (see the
  corrections), it drops to `cookie_refresh`. _Read-only._ Fix: make the refresh lines the guide's
  default. Under proxy auth, cap a new key's expiry at the window.
- **Invites outlive the person who sent them.** Disable and member removal revoke only invites
  addressed to the user (`orgMembers.ts:275`); nothing revokes invites they sent. In proxy mode,
  accepting an invite creates an allowlist row for `invite.email` without checking who is visiting
  (`accept-invite/+page.server.ts:126`). `email_domains = ["*"]` with no "assignment required" lets
  guest accounts through the proxy. A leaver can invite an identity they control, and it survives
  both disables. _Read-only._ Fix: revoke invites by inviter on disable and removal; re-check the
  inviter at accept; in proxy mode require the proxied identity to equal `invite.email`; have the
  guide set "Assignment required" or `allowed_groups`.

### Medium

- **The email fallback prefers the header-written email column over an exact UPN row**
  (`users.ts:118`). _Reproduced._ Fix: never match on the header-written column; prefer an exact UPN
  match; adopt by email only a row that has never signed in.
- **The OAuth code carries the raw key** (`oauth/index.ts:312`, `g: grant`). Anyone with
  `SELVA_HMAC_KEY` and a stale code from browser history or a proxy log gets a live key, with no
  PKCE verifier and no TTL check. An abandoned consent is cleaned up only by an in-process timer,
  which a restart loses. _Reproduced._ Fix: seal user, org and scopes in the code, and mint the key
  at `/oauth/token` after re-checking the user. The archived upload plan lists mint-before-redeem as
  a known gap; the raw key inside the code is new.
- **Live solve events can't reach Selva through the guide's Caddyfile.** Compute posts to
  `/api/v1/solve-events/<id>` with an HMAC bearer that isn't `selva_`, so `forward_auth` answers.
  The documented workaround, `SELVA_EVENT_CALLBACK_ORIGIN` pointed at a direct port, lets anything
  in the VPC send `SELVA-*` headers straight to Selva. _Read-only._ Fix: add
  `/api/v1/solve-events/*` to the bypass, since the route checks its own HMAC; under header-auth the
  callback origin must be the proxy's.
- **OAuth and login rate limits key on `127.0.0.1` behind Caddy.** Part 6 of the guide omits
  `ADDRESS_HEADER` and `XFF_DEPTH` (`lib/server/oauth/server.ts:94-98`), so one anonymous client can
  block every plugin and MCP sign-in. _Read-only._ Fix: add both to Part 6.
- **oauth2-proxy runs as `www-data`, which owns the config** (guide `:102`, `:113`). Every web
  worker on the box can read `cookie_secret`, which can forge a session for anyone. Fix: a dedicated
  system user, the config `root:oauth2-proxy 640`, and say plainly what `cookie_secret` is.
- **`cookie_domains` sends the session cookie to every subdomain**, and `cookie_samesite` is unset.
  Fix: a host-only cookie, and `cookie_samesite = "lax"`.
- **The Caddy `copy_headers` note depends on the Caddy version.** Since
  [GHSA-7r4p-vjf4-gxv4](https://github.com/caddyserver/caddy/security/advisories/GHSA-7r4p-vjf4-gxv4)
  was fixed in 2.11.2, `copy_headers` drops the client's copy. Inside a `handle`, `request_header`
  always runs after `forward_auth`. Fix: require Caddy 2.11.2 or later, and say "always after".

### Low

- **A future `lastLoginAt` never lapses**, for example after clock skew or a restored allowlist, and
  `touchLastLogin`'s debounce never corrects it (`users.ts:199`). _Reproduced._ Fix: treat a stamp
  more than a little ahead of now as lapsed, and overwrite it.
- **The lapsed 401 and the holder 403 have their own messages** (`api-token.ts:85`, `:93`), so
  whoever holds a leaked key learns that it is genuine and that its owner has been away.
  _Reproduced._ Fix: send the same body as an invalid key, and log the reason with the token id only.
- **The window is silently ignored on providers without `proxyAuth`.** Fix: log it at boot.

## 4. Decisions for a human

- **Window default.** Recommend on for header-auth, `0` to opt out, with service accounts as the
  answer for integrations. Off-by-default is what makes the High finding above possible.
- **Revoke at lapse.** Recommend yes. It closes the UPN-reuse revival, and the plugin already signs
  in again.
- **Refresh as the guide's default.** Recommend yes, on oauth2-proxy v7.15.5 or later. Microsoft's
  implicit grant means it costs IT nothing.
- **Object-ID identity.** It needs oauth2-proxy's alpha config, or a proxy that can forward `oid`.
  Recommend: fix the email-fallback order and add a "UPN changed" runbook with an admin rebind now;
  object ID later.
- **Session-only org-member routes.** Recommend yes, now. It's small and doesn't depend on anything
  else here.

## 5. Appendix: repros

Each test asserts that the bug is present.

UPN reuse revives a lapsed key (`offboarding.test.ts`):

```ts
const jane = await auth.createUser('jane@corp.com');
const { raw, token } = mintFor(jane.id);
const deps = depsFor(auth, token, 7 * DAY);
await setLastLogin(file, jane.id, new Date(Date.now() - 30 * DAY).toISOString());
expect((await resolveApiToken(req(raw), deps)).kind).toBe('rejected');
const newHire = await auth.proxyAuth!.identifyFromHeaders(
	new Headers({ 'SELVA-UserPrincipalName': 'jane@corp.com', 'SELVA-Email': 'jane@corp.com' })
);
expect(newHire?.id).toBe(jane.id);
expect((await resolveApiToken(req(raw), deps)).kind).toBe('ok');
```

An owner key rewrites membership (`member-takeover.test.ts`): a context shaped like the one
`resolveApiToken` returns for an owner's `write:all` key (`platformPermissions: []`,
`apiScope: write:all`) calls `updateOrgMember` on a co-owner and an admin, with no session. Both
calls succeed.

The OAuth code yields the key (`oauth-code.test.ts`):

```ts
const location = oauth.approve(request, {
	tokenId: 'tok-1',
	secret: 'selva_LIVE_RAW_KEY',
	scopes: ['read', 'upload'],
	expiresAt: new Date(t + 30 * 86_400_000).toISOString()
});
const code = new URL(location).searchParams.get('code')!;
t += 10 * 60_000; // past CODE_TTL_MS
// unseal(code) with SELVA_HMAC_KEY returns grant.secret === 'selva_LIVE_RAW_KEY'
```

The window fails open (`offboarding.test.ts`): `resolveApiTokenSignInWindowMs` returns `undefined`
for unset, `'7d'`, `'1w'` and `'0.5'`; only `'7d'` and `'1w'` log a warning.
