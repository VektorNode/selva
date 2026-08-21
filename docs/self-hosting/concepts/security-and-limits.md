---
title: Security & Limits
order: 6
published: true
description: 'Request limits, rate limiting, guards on outbound fetches, and the boundaries that keep a deployment safe.'
---

# Security & Limits

The guardrails an operator tunes: rate limits, size and concurrency caps, the guard
on remote-definition URLs, the two secret keys, and cookie/transport behaviour.
[`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example)
is the authoritative env-var list and documents each inline.

Sizes use `MB = 1024 × 1024`. Every cap resolves once at boot
(`packages/server/src/compute/limits.ts`); an invalid value warns and falls back to
the default.

## Rate limiting

Two independent limiters. Both count requests in a **fixed window** (the count
resets wholesale when the window ends, rather than sliding), and both keep those
counts **in memory only**, so nothing is persisted. In a multi-instance deployment
each instance keeps its own counts, so the effective rate is roughly N× the
per-key limit.

### Compute solves (`/api/v1/compute`)

| Env var                        | Default  | Meaning                                     |
| ------------------------------ | -------- | ------------------------------------------- |
| `COMPUTE_RATE_LIMIT_WINDOW_MS` | `100000` | Window length.                              |
| `COMPUTE_RATE_LIMIT_MAX`       | `120`    | Max solves per window (≈1.2/sec sustained). |

Keyed by caller: `user:<id>` for signed-in solves, `share:<linkId>` for
share-token solves, so anonymous link traffic never eats into the owner's budget.
Over the limit returns **429** with a `Retry-After` header.

### Login

Hardcoded, **not** env-configurable: **5 failed attempts per 15 minutes**, keyed
by client IP. Only failed logins count, and a success resets the count to zero.
Over the limit returns **429**.

### Share-link solve cap

Separate from rate limiting: each share link carries a stored `maxSolves` counter,
checked and raised in one indivisible step before each solve, so two solves
arriving together can't both slip past the last remaining slot. When exhausted the
solve returns **429** ("Share link solve cap reached").

## Size, concurrency, and queue caps

| Env var                              | Default              | Guards                                                                                                                                                                                                      |
| ------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPUTE_SOLVE_DEADLINE_MS`          | `100000`             | Longest a single solve may run before it is aborted. Renamed from `MAX_SOLVE_DURATION_MS`, which still works for one minor version and warns at boot.                                                       |
| `COMPUTE_MAX_QUEUE_DEPTH`            | `0` (unbounded)      | Max solves allowed to wait. A full queue is rejected with **503** + `Retry-After`.                                                                                                                          |
| `COMPUTE_QUEUE_WAIT_MS`              | `0` (no deadline)    | Max time a solve may sit queued before it is rejected with **503**.                                                                                                                                         |
| `MAX_DEFINITION_FILE_SIZE_BYTES`     | `52428800` (50 MB)   | Largest `.gh` on upload, and the cap on remote-definition fetches.                                                                                                                                          |
| `MAX_IMAGE_FILE_SIZE_BYTES`          | `10485760` (10 MB)   | Cover-image upload cap.                                                                                                                                                                                     |
| `COMPUTE_REQUEST_MAX_BYTES`          | `268435456` (256 MB) | `/api/v1/compute` request-body cap (inputs, values, base64 file widgets). Keep ≤ `BODY_SIZE_LIMIT`.                                                                                                         |
| `COMPUTE_RESPONSE_MAX_BYTES`         | `314572800` (300 MB) | `/api/v1/compute` response cap, kept under the ~512 MB ceiling on a single text value in Node so a huge result fails cleanly rather than crashing. Over the cap returns **413**.                            |
| `REMOTE_DEFINITION_FETCH_TIMEOUT_MS` | `30000`              | Deadline on remote-definition fetch, so a server that trickles bytes forever can't tie one up indefinitely.                                                                                                 |
| `BODY_SIZE_LIMIT`                    | `256M`               | adapter-node's global body cap on **every** route. Must be ≥ `COMPUTE_REQUEST_MAX_BYTES`. Use `256M` or a raw byte count — only `K`/`M`/`G` are units, so `256mb` and `Infinity` are NaN and throw on boot. |

How many solves may run at once is not an env var: Selva probes the compute server's
active child count, once at connect and again after solves, since children exit under
`--idlespan` and the pool resizes at runtime. A failed probe — or a cold server
honestly reporting `0` — falls back to `1`, on the grounds that an unknown-capacity
server is safer under-used than oversent. The one place to change it is
`--childcount` on the compute server.

Cache byte budgets (`COMPUTE_DEFINITION_CACHE_MB`, `COMPUTE_SOLVE_CACHE_MB`) and the
Rhino.Compute server flags are covered in [Caching](./caching.md).

## Guard on remote-definition URLs

A definition can be loaded from a user-supplied URL. Without a check that URL could
point back at your own network — a private-address database, a cloud metadata
endpoint — and the server would fetch it and hand back the result. That's SSRF.

`packages/server/src/compute/safe-url.ts` validates before any fetch, using a scheme
allowlist plus an address blocklist, checked twice:

1. **The URL text, no DNS.** Scheme must be `http` or `https`. `localhost` and
   `*.localhost` are rejected, as is every encoding of a private IPv4 address
   (decimal, octal, hex, short-form, IPv4-mapped IPv6) — each is canonicalized before
   judging.
2. **The resolved addresses**, each re-checked against the same list, because a
   harmless-looking hostname can resolve to a private one.

Blocked: `0.0.0.0/8`, loopback (`127/8`, `::1`, `::`), private ranges (`10/8`,
`172.16–31`, `192.168/16`, `fc00::/7`), and link-local (`169.254/16` — **including
the cloud metadata endpoint `169.254.169.254`** — and `fe80::/10`).

Every rejection returns the same vague message, `Remote definition URL is not
allowed`, so nobody can map your internal network by watching which URLs it
complains about differently; the specific reason is logged server-side.

One gap is documented rather than closed: an address can change between the check
and the fetch (DNS rebinding), so a hostname that passes could be pointed elsewhere
a moment later.

Rhino.Compute _server_ URLs are not subject to this guard; they are configured in
`/admin/compute` and stored by the data provider, not fetched from user input.

## Secrets

Two keys. Both are required under every provider, and `npx @selvajs/cli` generates
both for you at scaffold time, so you never write one by hand.

| Key                 | Protects                                                                             | Format                                               | Rotating it…                                                             |
| ------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `SELVA_HMAC_KEY`    | Signs session cookies; hashes share-link and invite tokens at rest.                  | ≥ 32 characters.                                     | Logs everyone out and invalidates every share link and pending invite.   |
| `SELVA_AT_REST_KEY` | AES-256-GCM encryption of the Rhino.Compute API key at rest (on disk and in the DB). | 64-char hex, or base64 decoding to exactly 32 bytes. | Makes the stored API key undecryptable; re-enter it at `/admin/compute`. |

What each key covers shifts with the auth provider, but neither becomes optional:

- **`local`:** the HMAC key signs session cookies _and_ hashes tokens; the at-rest
  key encrypts the compute API key in `compute.config.json`.
- **`supabase`:** sessions are Supabase JWTs, so the HMAC key only hashes tokens.
  The at-rest key still encrypts `compute_servers.api_key`, and
  `SupabaseDataProvider` refuses to construct without it.

`SELVA_AT_REST_KEY` is encryption at rest: it defends against a leaked backup or
read-only storage access, not against an attacker who already holds the running
process's memory. A key mismatch is detected at boot and surfaced in the admin
system health view.

### Why two keys and not one

One signs, one encrypts, and they fail asymmetrically: losing the HMAC key costs a
round of logins, losing the at-rest key costs a credential you must re-enter by hand.
Keeping them separate is what lets `selva keys rotate hmac` treat a suspected
session-secret leak as routine instead of an action that also takes compute offline.

They aren't interchangeable anyway — at-rest must decode to exactly 32 bytes, HMAC
only needs 32 characters. If one `.env` entry ever becomes the goal, derive two keys
from a single root secret rather than passing the same bytes to both.

### What rotating `SELVA_HMAC_KEY` breaks

`selva keys rotate hmac` takes effect on restart. Nothing errors; the affected things
simply stop being found:

1. **Sessions — local provider only.** Every issued cookie fails its signature check
   and everyone signs in again. Under `supabase` or `header` auth, sessions never
   touch this key and are unaffected.
2. **Share links — all providers.** Links are looked up by hash, so existing ones
   read as invalid. Mint replacements from the definition's share dialog.
3. **Pending invites — all providers.** Same mechanism; unaccepted invites read as
   "invalid or has expired". Already-accepted invites are unaffected — membership is a
   stored record, not a token. Re-send any still open.

Rows for dead links and invites stay in the store, unreachable and harmless. Rotation
does not clean them up.

Untouched: user accounts, passwords (hashed with their own scheme), org membership
and permissions, projects, definitions, uploaded files, and the Rhino.Compute API key
(that's `SELVA_AT_REST_KEY`).

## Cookies and transport

- **Secure cookies.** In production, session and refresh cookies are marked
  `Secure`, so the browser only sends them over HTTPS. They are also `httpOnly`
  (JavaScript on the page cannot read them) and `sameSite=lax` (they are not sent
  along with requests originating from another site). Setting
  `ALLOW_INSECURE_COOKIES=true` drops the `Secure` mark, the escape hatch for
  HTTP-only deployments. This var is code-only and
  not listed in `.env.example`; without it, cookies over plain `http://` in
  production are dropped and login silently fails.
- **`ORIGIN`.** Selva checks that a form submission came from its own site, which
  stops another site from making a logged-in visitor's browser submit one on their
  behalf. To do that it has to know its own public address: behind a reverse proxy,
  set `ORIGIN=https://your-domain.com` (no trailing slash). Without it, form POSTs
  fail with "Cross-site POST form submissions are forbidden".
- **`HOST` / header-auth boundary.** `HOST` defaults to `0.0.0.0` (adapter-node's
  default). Under the header-auth provider the app **must** be reachable only through
  the trusted proxy — bind `127.0.0.1` or firewall the port. The proxy must
  authenticate every request and **overwrite** the inbound `SELVA-*` headers, since
  Selva reads them as identity and never strips them itself. There is no runtime
  check; the deployment is the entire trust boundary.

## Logging and personal data

`PinoLogger` strips values by **field name** only, and only credential-shaped names.
Eight at the top level — `token`, `sessionToken`, `refreshToken`, `apiKey`,
`api_key`, `password`, `authorization`, `cookie` — of which only five are also
matched one level down (`*.token`, `*.sessionToken`, `*.refreshToken`, `*.apiKey`,
`*.password`). Nothing deeper, and `authorization`, `cookie`, and `api_key` are
**not** caught when nested.

It does **not** catch emails or other personal data buried in a payload, and it only
runs when the optional `pino` package is installed — the console fallback strips
nothing. Log identifiers (`eventType`, `actorId`, `userId`), never whole domain
objects. An audit payload can embed an invitee's email, and logs are the one place
erasure cannot reach. See [data privacy](./data-privacy.md) for the full contract.

## Next

- [Caching](./caching.md): the cache byte budgets referenced above.
- [Providers](../providers/overview.md): where secrets and the trust boundary come from.
- [Admin guide](./admin.md): where compute keys and limits surface in the UI.
