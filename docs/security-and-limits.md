---
title: Security & Limits
group: Concepts
order: 6
published: true
description: 'Request limits, SSRF guards, rate limiting, and the boundaries that keep a deployment safe.'
---

# Security & Limits

A reference for the guardrails an operator tunes: rate limits, request-size and
concurrency caps, the SSRF guard on remote definitions, the two secret keys, and
cookie/transport behaviour. Every setting below is verified against the code;
[`.env.example`](../packages/selva/.env.example) is the authoritative env-var list
and documents each inline.

Sizes below use `MB = 1024 × 1024`. All the `COMPUTE_*` / `*_BYTES` / `*_MS` caps
are resolved once at boot; an invalid value warns and falls back to the default.

## Rate limiting

Two independent limiters, both **fixed-window** and **in-memory** (nothing is
persisted). In a multi-instance deployment each instance keeps its own counters,
so the effective rate is roughly N× the per-key limit.

### Compute solves (`/api/compute`)

| Env var                        | Default  | Meaning                                     |
| ------------------------------ | -------- | ------------------------------------------- |
| `COMPUTE_RATE_LIMIT_WINDOW_MS` | `100000` | Window length.                              |
| `COMPUTE_RATE_LIMIT_MAX`       | `120`    | Max solves per window (≈1.2/sec sustained). |

Keyed by caller: `user:<id>` for signed-in solves, `share:<linkId>` for
share-token solves, so anonymous link traffic never eats into the owner's budget.
Over the limit returns **429** with a `Retry-After` header.

### Login

Hardcoded, **not** env-configurable: **5 failed attempts per 15 minutes**, keyed
by client IP. Only failed logins count; a success clears the bucket. Over the
limit returns **429**.

### Share-link solve cap

Separate from rate limiting: each share link carries a persisted `maxSolves`
counter, checked-and-incremented atomically before each solve. When exhausted the
solve returns **429** ("Share link solve cap reached").

## Size, concurrency, and queue caps

All resolved in `packages/server/src/compute/limits.ts`.

| Env var                              | Default              | Guards                                                                                                                                                                                                       |
| ------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `COMPUTE_SOLVE_DEADLINE_MS`          | `100000`             | Longest a single solve may run before it is aborted. Renamed from `MAX_SOLVE_DURATION_MS`, which still works for one minor version and warns at boot.                                                        |
| `COMPUTE_MAX_QUEUE_DEPTH`            | `0` (unbounded)      | Max solves allowed to wait. A full queue is rejected with **503** + `Retry-After`.                                                                                                                           |
| `COMPUTE_QUEUE_WAIT_MS`              | `0` (no deadline)    | Max time a solve may sit queued before it is rejected with **503**.                                                                                                                                          |
| `MAX_GH_FILE_SIZE_BYTES`             | `52428800` (50 MB)   | Largest `.gh` on upload, and the cap on remote-definition fetches.                                                                                                                                           |
| `MAX_IMAGE_FILE_SIZE_BYTES`          | `10485760` (10 MB)   | Cover-image upload cap.                                                                                                                                                                                      |
| `COMPUTE_REQUEST_MAX_BYTES`          | `220200960` (210 MB) | `/api/compute` request-body cap (inputs, values, base64 file widgets). Keep ≤ `BODY_SIZE_LIMIT`.                                                                                                             |
| `COMPUTE_RESPONSE_MAX_BYTES`         | `314572800` (300 MB) | `/api/compute` response cap; a backstop under V8's ~512 MB string wall. Over the cap returns **413**.                                                                                                        |
| `REMOTE_DEFINITION_FETCH_TIMEOUT_MS` | `30000`              | Deadline on remote-definition fetch (slow-loris protection).                                                                                                                                                 |
| `BODY_SIZE_LIMIT`                    | `210M`               | adapter-node's global body cap on **every** route. Must be ≥ `COMPUTE_REQUEST_MAX_BYTES`. Use `210M` or a raw byte count — adapter-node reads only the last suffix character, and `Infinity` throws on boot. |

In-flight concurrency is not an env var: Selva always auto-detects it from the
compute server's active `compute.geometry` child count (re-probed periodically
as the pool resizes), falling back to `1` if that count can't be read. The one
place to change it is `--childcount` on the compute server itself.

Cache byte budgets (`COMPUTE_DEFINITION_CACHE_MB`, `COMPUTE_SOLVE_CACHE_MB`) and the
Rhino.Compute server flags are covered in [Caching](Caching.md).

## SSRF guard on remote definitions

When a definition is loaded from a user-supplied URL, the URL is validated before
any fetch (`packages/server/src/compute/safe-url.ts`). There is **no allowlist** —
it is a denylist of private and reserved ranges, applied in two passes:

1. A DNS-free literal pre-filter (scheme must be `http`/`https`; rejects
   `localhost`, all IPv4 encodings — integer, octal, hex, short-form — and mapped
   IPv6).
2. A DNS resolution that re-checks every resolved A/AAAA address.

Blocked: loopback (`127/8`, `::1`), private ranges (`10/8`, `172.16–31`,
`192.168/16`, `fc00::/7`), link-local **including the cloud metadata endpoint
`169.254.169.254`**, and the unspecified/`0.0.0.0` addresses. Rejections return a
deliberately generic message ("Remote definition URL is not allowed") so the guard
can't be used as a probe; the specific reason is logged server-side.

DNS-rebinding is not fully closed (the resolved IP could change between the check
and the fetch) — a documented limitation. Rhino.Compute _server_ URLs are not
subject to this guard; they are configured in `/admin/compute` and stored by the
data provider, not fetched from user input.

## Secrets

Two keys, both required (the `local` provider needs both; `supabase` needs
`SELVA_AT_REST_KEY`). Generate them with the command shown in `.env.example`.

| Key                 | Protects                                                                             | Format                                               | Rotating it…                                                                |
| ------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `SELVA_HMAC_KEY`    | Signs session cookies; fallback secret for share-link and invite tokens.             | ≥ 32 characters.                                     | Logs everyone out and invalidates share/invite tokens that fell back to it. |
| `SELVA_AT_REST_KEY` | AES-256-GCM encryption of the Rhino.Compute API key at rest (on disk and in the DB). | 64-char hex, or base64 decoding to exactly 32 bytes. | Makes the stored API key undecryptable — re-enter it at `/admin/compute`.   |

Dedicated `SHARE_LINK_SECRET` and `INVITE_TOKEN_SECRET` can override the HMAC-key
fallback; rotating either instantly invalidates all tokens of that kind.
`SELVA_AT_REST_KEY` is encryption at rest — it defends against a leaked backup or
read-only storage access, not against an attacker who already holds the running
process's memory. A key mismatch is detected at boot and surfaced in the admin
system health view.

## Cookies and transport

- **Secure cookies.** In production, session/refresh cookies are `Secure` (plus
  `httpOnly`, `sameSite=lax`). Setting `ALLOW_INSECURE_COOKIES=true` disables
  `Secure` — the escape hatch for HTTP-only deployments. This var is code-only and
  not listed in `.env.example`; without it, cookies over plain `http://` in
  production are dropped and login silently fails.
- **`ORIGIN` / CSRF.** Behind a reverse proxy, set `ORIGIN=https://your-domain.com`
  (no trailing slash). Without it, form POSTs fail with "Cross-site POST form
  submissions are forbidden".
- **`HOST` / header-auth boundary.** `HOST` defaults to `0.0.0.0`. When running the
  header-auth provider, the app **must** be reachable only through the trusted
  proxy (bind `127.0.0.1` or firewall the port), the proxy must authenticate every
  request, and it must strip inbound `SELVA-*` headers. There is no runtime check —
  the deployment is the entire trust boundary.

## Logging and personal data

`PinoLogger` redacts by **credential field name** only (`token`, `apiKey`,
`password`, `authorization`, `cookie`, and one level of nesting for most). It does
**not** catch emails or other personal data nested inside a payload, and redaction
only applies when the optional `pino` package is installed (the console fallback
does none). Log identifiers (`eventType`, `actorId`, `userId`), never whole domain
objects — an audit payload can embed an invitee's email, and logs are the one
place erasure cannot reach. See the Data Privacy section of the repo `CLAUDE.md`
for the full contract.

## Next

- [Caching](Caching.md) — the cache byte budgets referenced above.
- [Providers](providers.md) — where secrets and the trust boundary come from.
- [Admin guide](admin.md) — where compute keys and limits surface in the UI.
