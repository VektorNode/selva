# Selva App Security Audit — Fix Plan

> **Status: CLOSED (archived 2026-08-21). All six findings fixed; [#194](https://github.com/VektorNode/selva/issues/194)
> and every sub-issue closed.** SEL-1 landed separately on 2026-08-17; SEL-2 through SEL-6 landed
> together. Each issue carries the implementation reasoning — read those, not this document, for what
> the code does now.
>
> **One fix needs operator action and will not take effect on its own:**
> `ADDRESS_HEADER=X-Forwarded-For` + `XFF_DEPTH=<proxy count>` must be set per deployment or SEL-2's
> per-address bucket still collapses; the per-account limiter and a boot warning cover the gap until
> then.
>
> **SEL-3 was narrowed from what this plan proposed.** The plan called for routing `serverUrl`
> through `assertSafeRemoteDefinitionUrl`, which blocks all private ranges. That would reject
> `localhost` and RFC1918 — how most deployments actually reach their compute server — so it shipped
> as a link-local-only block (`169.254.0.0/16`, the cloud metadata range) with no opt-out flag. A
> guard every operator has to disable protects nobody. The residual risk the plan wanted covered, a
> `manage_compute` holder probing an internal host, is accepted: it needs a privileged actor already
> and is inseparable from the legitimate case.
>
> **Still open, tracked elsewhere:** B5-lb (multi-instance rate-limit drift, the horizontal-scaling
> half of SEL-2) and S4 (`ORIGIN` boot validation, adjacent to SEL-5), both in
> [data-access-efficiency-audit](../fixes/data-access-efficiency-audit.md). The
> [Known and accepted](#known-and-accepted--no-action-proposed) section below was deliberately not
> actioned and still describes live tradeoffs.

**Tracked in [#194](https://github.com/VektorNode/selva/issues/194).**

**Run:** 2026-08-16 (branch `feat/docs-website`) by five parallel read-only reviewers across
authentication/session, authorization/IDOR, input validation and file handling, semi-public
surfaces (share links, invites, rate limiting), and secrets/logging/headers. Every finding below
was then re-read against current source before it was written down; SEL-2's reported cause was
wrong on the first pass and is corrected here.

**Scope:** `packages/selva` server code plus the code it delegates to in `packages/platform`,
`packages/server`, `packages/providers/local`.
**Not in scope:** the Grasshopper plugin and its loopback WebSocket/HTTP server, Supabase provider
internals, and runtime/infrastructure config beyond what the repo documents.

**Status lives on the issues, not here** — see the Tracked-in links above and in each section.

Overall the app holds up: auth is deny-by-default, tenancy checks never trust a URL id alone,
share-link tokens are HMAC-hashed at rest with 256-bit entropy, compute API keys are AES-256-GCM
encrypted and never serialized to a client, path traversal is blocked by two independent layers,
and `pnpm audit --prod` is clean. Two items are real defects with a path to impact; the rest is
hardening.

---

## At a glance

| Issue                                                  | ID        | Item                                                                    | Severity |
| ------------------------------------------------------ | --------- | ----------------------------------------------------------------------- | -------- |
| [#195](https://github.com/VektorNode/selva/issues/195) | **SEL-1** | Org admin can grant themselves `owner` through the invite flow          | High     |
| [#196](https://github.com/VektorNode/selva/issues/196) | **SEL-2** | Login limiter keys every request to `127.0.0.1` — instance-wide lockout | High     |
| [#197](https://github.com/VektorNode/selva/issues/197) | **SEL-3** | Admin-set compute `serverUrl` is fetched server-side with no SSRF guard | Medium   |
| [#198](https://github.com/VektorNode/selva/issues/198) | **SEL-4** | Password-hash file written with default (world-readable) permissions    | Medium   |
| [#199](https://github.com/VektorNode/selva/issues/199) | **SEL-5** | No CSRF `state`/PKCE check at the OAuth callback seam — **confirmed**   | Low      |
| [#200](https://github.com/VektorNode/selva/issues/200) | **SEL-6** | Admin pages framable; error path bypasses pino redaction                | Low      |

Related open items already tracked in
[data-access-efficiency-audit](../fixes/data-access-efficiency-audit.md): **B5-lb** (multi-instance
rate-limit drift) is the horizontal-scaling half of SEL-2 — fixing SEL-2 does not close it, and
closing B5-lb with a shared store does not fix SEL-2's key collapse. **S4** (validate `ORIGIN` at
boot, Origin allowlist) is adjacent to SEL-5.

---

## SEL-1 — Org admin escalates to owner via invite [High]

**Tracked in [#195](https://github.com/VektorNode/selva/issues/195).**

`PATCH /api/v1/orgs/{orgId}/members/{userId}` deliberately restricts role changes to the org owner
(`members/[userId]/+server.ts:74` — "Only the org owner can change roles."). The invite endpoint
reaches the same outcome with no equivalent gate:

- `invites/+server.ts:38` gates only on `requireManageOrgMembers`.
- `DEFAULT_ORG_PERMISSIONS.admin` is `[...ALL_ORG_PERMISSIONS]`
  (`platform/src/organizations/schemas.ts:88`), so every admin holds `manage_org_members`.
- `CreateInviteBodySchema.orgRole` (`api/v1/bodies.ts:74`) accepts any `OrgRole`. The
  `MEMBER_ASSIGNABLE_PERMISSIONS` intersection at `:48-51` only guards the `member` branch —
  owner/admin invites take the full set by design.
- `accept-invite/+page.server.ts:119` stamps `role: invite.orgRole` verbatim into `addOrgMember`
  under `SYSTEM_CONTEXT`. No authorization is re-evaluated at accept time.

An admin invites an email they control with `orgRole: "owner"`, accepts it, and holds owner
authority — including the sole-owner invariant and the very role-change gate meant to exclude
them. The same asymmetry lets an admin promote any third party to owner by re-inviting them.

**Fix.** Gate the invitable `orgRole` on the actor's own role: only an owner may invite an `owner`
(and arguably an `admin`). Put the rule next to the existing permission intersection in the POST
handler so the two paths can't drift apart again — this is the same "one rule, two siblings"
hazard called out for `/api/admin/*` vs `/api/v1/*` — one rule, one place.

**Regression test.** Admin actor + `orgRole: "owner"` → 403. Owner actor + `orgRole: "owner"` → 201. Cover it in the existing `invites/__tests__`.

---

## SEL-2 — Login rate limiter collapses to one global bucket [High]

**Tracked in [#196](https://github.com/VektorNode/selva/issues/196).** Two of the five reviewers reported this as a spoofable `X-Forwarded-For`. **That is
wrong, and the real cause is worse — do not re-file it as header spoofing.**

`ADDRESS_HEADER` is never set anywhere in the repo (`.env.example`, deployment docs, Caddyfile), so
adapter-node's handler ignores `X-Forwarded-For` entirely and `getClientAddress()` returns the raw
socket peer. The documented deployment binds the app to `127.0.0.1:3000` behind a reverse proxy
(`docs/self-hosting/deployment/reverse-proxy.md:10`, `Caddyfile.example:23`), so that peer is
**always `127.0.0.1`**, for every request from every user.

The limiter's key space therefore has exactly one bucket
(`admin-auth.server.ts:19-34`, consumed at `login/+page.server.ts:67`):

1. An unauthenticated attacker submits five failed logins from anywhere.
   `recordFailedAttempt('127.0.0.1')` fills the shared bucket (5 per 15 min).
2. `checkRateLimit` now returns `allowed: false` for every user — all keyed to the same address.
   Everyone gets a 429.
3. `clearRateLimit` runs **only** on a successful login, which nobody can now reach. The lockout
   holds for the full window and is trivially renewed.

Cheap, repeatable, unauthenticated denial of service against the whole instance. The mirror-image
problem: brute-force protection is simultaneously meaningless, because an attacker targeting one
account contends with a global counter rather than a per-account limit. The only real bound on
online guessing today is PBKDF2 cost.

**Fix — both halves are needed.**

1. Set `ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH=1`, and document them in
   `packages/selva/.env.example` and the reverse-proxy runbook. This restores per-client keys and
   is only safe _because_ the app is bound to loopback — say so in the doc, since the two settings
   are a footgun on a directly-reachable app.
2. Add a per-account failure counter alongside the per-IP one. IP-only limiting does not bound a
   distributed guessing attack, and per-account is what actually protects a targeted user.

Consider also having the limiter refuse to start, or warn loudly at boot, if every observed client
address is loopback — the failure mode is silent today.

**Regression test.** Two distinct client addresses; five failures on the first must not throttle
the second.

---

## SEL-3 — Compute server URL fetched with no SSRF guard [Medium]

**Tracked in [#197](https://github.com/VektorNode/selva/issues/197).**

`validateIncomingServers` (`lib/server/compute/serverConfigWrite.ts:37-53`) checks only that
`new URL(s.serverUrl)` parses — no scheme allowlist, no private-IP or link-local block. The stored
URL is then fetched server-side on every status probe, purge/shutdown action
(`api/admin/compute/actions/+server.ts:47`), and solve (`solve.server.ts:318`).

The codebase already has the right defense and simply doesn't apply it here:
`assertSafeRemoteDefinitionUrl` (`packages/server/src/compute/safe-url.ts:168`) blocks private
ranges and exotic IP literal encodings, and guards the remote-definition path. A holder of
`manage_compute` can point the server at `http://169.254.169.254/latest/meta-data/` or an intranet
host and have the app fetch it.

Severity is capped because the actor is a privileged, trusted admin. **Raise to High if
`manage_org_compute` is ever delegated more widely on a multi-tenant instance** — that flag is the
thing to watch.

**Fix.** Route `serverUrl` through the existing guard, or at minimum enforce an `http`/`https`
scheme allowlist plus the private-range check. Keep it in `serverConfigWrite.ts` so both the
platform-scope and org-scope routes inherit it.

---

## SEL-4 — Secret files written world-readable [Medium]

**Tracked in [#198](https://github.com/VektorNode/selva/issues/198).**

`writeJsonFile` (`packages/providers/local/src/data/fsJson.ts:29`) calls
`fs.writeFile(tmp, …, 'utf-8')` with no `mode`, and `fs.rename` preserves the temp file's
umask-derived permissions — typically `0644`. This helper is the sole writer for
`auth-users.json` (email addresses + PBKDF2 password hashes) and `compute.config.json`.

Any other local user or co-tenant service on the host can read the password hashes and crack them
offline. The encrypted API keys hold up — AES-256-GCM is useless to a reader without
`SELVA_AT_REST_KEY` — but the password hashes have no second layer.

**Fix.** Write the temp file with `{ mode: 0o600 }` and create the data directory `0700`. One
change in the shared helper covers both stores. Note this is a no-op on Windows dev machines, so
verify on Linux.

---

## SEL-5 — No CSRF `state` on the OAuth callback seam [Low, confirmed]

**Tracked in [#199](https://github.com/VektorNode/selva/issues/199).**

`auth/supabase/callback/+server.ts:22` and `auth/email/callback/+server.ts:20` are GET handlers
that mint and set a session cookie. SvelteKit's CSRF origin check covers form POSTs, not GETs, and
`supabase/start/+server.ts:42-47` forwards only `redirectTo` — no `state` is generated or compared
at the app layer.

The classic consequence is login CSRF: an attacker starts their own OAuth flow, captures their
`?code=`, and induces the victim to load the callback with it, silently logging the victim into
the attacker's account where subsequent activity is visible to the attacker.

**Verified 2026-08-16 — the hedge is resolved, this is a real finding.** The adapter was the open
question: `SupabaseAuthProvider.exchangeOAuthCode` takes only `code`, so nothing enforces `state`
or PKCE at any layer. The fix stands as written: generate a nonce at start, store it in a
short-lived cookie, compare
on callback.

Not a finding, recorded so it isn't re-investigated: `safeRedirectTarget`
(`packages/server/src/http/redirect.ts:6-16`) correctly rejects absolute and protocol-relative
URLs, so there is no open redirect on the login path.

---

## SEL-6 — Framable admin pages; error path skips log redaction [Low]

**Tracked in [#200](https://github.com/VektorNode/selva/issues/200).** Two small, unrelated items sharing a priority.

**Clickjacking.** `packages/server/src/http/security-headers.ts:22-28` deliberately omits CSP and
frame headers because Selva apps are built for iframe embedding, and a test pins that
(`security-headers.test.ts:24`). The tradeoff is right for app routes but is applied uniformly at
`hooks.server.ts:383`, so `/admin/*` and `/setup` are framable too — leaving an authenticated
instance admin open to UI-redress attacks. `SameSite=Lax` blunts cross-site POST, not same-origin
redress. **Fix:** set `X-Frame-Options: DENY` (or `frame-ancestors 'none'`) selectively on
`/admin/*` and `/setup`; leave embeddable routes untouched and keep the pinning test honest by
scoping it.

**Unredacted error logging.** `handleApiError` (`lib/server/api-errors.ts:108`) logs via raw
`console.error(…, err)` rather than the pino logger, so `REDACTED_PATHS`
(`packages/server/src/logging/PinoLogger.ts:44`) never runs on it. Provider adapters stash
connection details in `cause`, which reaches stdout unredacted — the one place erasure cannot
follow (see the logging prohibition in the data-privacy doc). Same at `providers.server.ts:304`. The client
still correctly receives a generic 500 with no stack. **Fix:** route through
`locals.log.error(…, { err: renderThrown(err) })`, as the `+server.ts` handlers already do.

**Cheap adjacent hardening.** `SELVA_HMAC_KEY`'s `.env.example` placeholder is 41 chars, so it
passes the `MIN_HMAC_SECRET_LENGTH = 32` guard (`LocalAuthProvider.ts:110`) and an operator who
copies the file without rotating boots with a publicly known signing key. `selva doctor` catches
it (`packages/cli/src/checks/config.js:9`), but `fromEnv()` should reject the literal placeholder
too.

---

## Verified clean

Recorded so the next audit doesn't re-derive them. Each was traced end-to-end.

- **Path traversal** on `/api/files/[...path]` — two independent layers: an anchored regex registry
  with `hasUnsafeSegment` (`platform/src/storage/assetClasses.ts:91`) rejecting `\`, empty, `.`,
  `..`, then `LocalStorageProvider.resolvePath:32` containment. Encoded traversal is decoded by
  SvelteKit before the param and still caught. Project asset paths are re-derived from
  `definitionPaths`, never echoed.
- **Definition/version IDOR** — `getVisibleDefinition` / `loadVisibleVersion` re-check `canView`
  and enforce `version.definitionId === record.guid`; guid guessing is masked to 404 via
  `concealAccessFailure`.
- **Share links** — 256-bit entropy, HMAC-hashed at rest, raw token returned once and never
  persisted, expiry/revocation re-checked at use time, scoped to one `(definition, channel)` pair,
  `allowSolve` gated, deleted-parent guarded. The synthetic ctx has `userId: ''` and empty
  permissions and cannot reach other definitions.
- **Compute API keys** — AES-256-GCM at rest, plaintext-on-disk refused loudly, stripped to
  `hasApiKey` in every response schema. Both `includeApiKeys: true` reads are write-path merges.
- **Self-update command injection** — all interpolated values pass `shellQuote`, the channel comes
  from a closed enum via `isChannel`, no request body reaches the script, `instance_admin` gated.
- **Platform self-elevation** — the `platformChanged && !instance_admin` guard is present on both
  create and patch, with a last-instance-admin invariant on delete/disable.
- **Stored XSS via upload** — images rasterized to WebP by `transcodeImageIfNeeded`, `image/svg+xml`
  absent from the content-type map, `nosniff` global, no `{@html}` sink in `selva`/`ui` runtime.
- **Cross-tenant replay** — idempotency keys include the caller id
  (`computeIdempotency.server.ts:33`); rate-limit buckets separate `share:{linkId}` from
  `user:{userId}` so anonymous share traffic can't drain an owner's budget.
- **Invite privilege escalation via permissions payload** — `member` invites intersect with
  `MEMBER_ASSIGNABLE_PERMISSIONS`, so governance permissions can't be granted to a member. (The
  _role_ field is the hole — see SEL-1.)
- **First-run setup** — gated on `hasInstanceAdmin`; a re-run races into a duplicate-email 409.
- **Org tenancy** — `requireActingOrg` 403s when the URL `orgId` differs from `ctx.actingOrgId`,
  consistently, across every `[orgId]` route.
- **JSON body validation** — every `api/v1` and `api/admin` JSON handler parses through Zod before
  reaching a store. The one raw `request.json()` (`api/v1/compute/+server.ts:45`) presence-checks
  its fields and its dangerous one (`definitionUrl`) is re-validated by the SSRF guard.

---

## Known and accepted — no action proposed

- **Logout doesn't revoke.** Local HMAC sessions are stateless bearer tokens valid for the full 8h
  window; logout clears the cookie only, so a captured token survives it. Disabling a user _is_
  honored immediately (`LocalAuthProvider.verifyToken:135`). Either document that local sessions
  are irrevocable until expiry, or add a token-version claim.
- **Denial-of-wallet on share links.** The solve cap bounds count (default 1000), not compute cost,
  and a minter can choose an uncapped link with no warning. Acknowledged in-code at
  `platform/src/shareLinks/types.ts:29-32`. Consider disallowing `null` on public `allowSolve`
  links.
- **Login timing side-channel.** An unknown user returns before PBKDF2 runs; a wrong password runs
  the full hash. Error strings are identical, but the timing gap leaks account existence.
- **Body-size guard vs chunked encoding.** `requireMaxBodySize` reads `Content-Length` only, so a
  chunked request falls through to the global `BODY_SIZE_LIMIT` backstop. Documented in-code at
  `packages/server/src/http/body-size.ts:15`.
- **DNS-rebinding TOCTOU** in the remote-definition SSRF guard — documented and scoped out at
  `safe-url.ts:20-24`; `redirect: 'error'` closes the redirect bypass.
- **PBKDF2 at 100k iterations / SHA-256** is on the low side of current guidance but acceptable;
  params are parsed from the stored hash, so raising them stays backward-compatible.
