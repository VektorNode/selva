---
title: Security & Limits
order: 4
published: true
description: 'Request limits, rate limiting, guards on outbound fetches, and the boundaries that keep a deployment safe.'
---

# Security & Limits

[`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example) is the authoritative env-var list. Caps resolve once at boot (`packages/server/src/compute/limits.ts`); an invalid value warns and falls back to the default. `MB = 1024 × 1024`.

## Rate limiting

All limiters use a fixed window and keep counts in memory, so N instances enforce roughly N times the limit. Over the limit returns **429**.

### Compute solves (`/api/v1/compute`)

`COMPUTE_RATE_LIMIT_MAX` solves per 100-second window, default `120`. Keyed by `user:<id>` or, for share-token solves, `share:<linkId>`, so anonymous link traffic never uses the owner's budget. The response carries `Retry-After`.

### API tokens (`/api/v1`)

`API_TOKEN_RATE_LIMIT_MAX` requests per token per minute, default `600`; `0` turns it off. Browser sessions are not charged. A token solve also draws on its owner's compute bucket, so extra keys buy no extra compute. Responses carry `RateLimit-Limit` and `RateLimit-Remaining`, and `RATE_LIMITED` plus `Retry-After` when over. MCP calls pass through `/api/v1`, so they are limited as the token behind them.

### Login, OAuth and share links

- **Login:** a failed attempt counts against both the client IP (5 per 15 minutes) and the account (20 per 15 minutes). Both are fixed, not configurable. An attempt must clear both buckets; a success clears the account bucket and that IP's. The account cap is looser on purpose, because anyone can spend it from any IP to lock a known user out.
- **OAuth:** client registration and token exchange (`/oauth/register`, `/oauth/token`) allow 30 requests per minute per IP.
- **Share links:** each link has a `maxSolves` counter, checked atomically before every solve. When exhausted, the solve returns **429**.

## Size, concurrency and queue caps

| Env var                          | Default            | Guards                                                           |
| -------------------------------- | ------------------ | ---------------------------------------------------------------- |
| `COMPUTE_MAX_QUEUE_DEPTH`        | `0` (unbounded)    | Max queued solves. A full queue returns **503** + `Retry-After`. |
| `COMPUTE_QUEUE_WAIT_MS`          | `0` (none)         | Max queue time before **503**.                                   |
| `MAX_DEFINITION_FILE_SIZE_BYTES` | `52428800` (50 MB) | `.gh` uploads and remote-definition fetches.                     |
| `BODY_SIZE_LIMIT`                | `256M` (seeded)    | adapter-node body cap on every route. See below.                 |

Set on the compute server and read from it per server (see `/admin/compute`):

| Compute setting                                         | Default | Guards                                                                      |
| ------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `--timeout` / `RHINO_COMPUTE_TIMEOUT`                   | 100 s   | Longest single solve. Selva aborts 5 s after it, and never past an hour.    |
| `--max-request-size` / `RHINO_COMPUTE_MAX_REQUEST_SIZE` | 50 MB   | Largest solve request. Over it, the solve returns **413** naming the limit. |

Selva takes solve requests up to the largest `RHINO_COMPUTE_MAX_REQUEST_SIZE` a reached server reports, and up to 256 MB before it has reached one. `BODY_SIZE_LIMIT` must be at least that: `/admin/system` warns when it is lower.

A server that doesn't report them (standard rhino.compute, or an older fork) is assumed to run the defaults.

Fixed in code, not configurable:

| Cap                 | Value  | Guards                                                                      |
| ------------------- | ------ | --------------------------------------------------------------------------- |
| Solve response body | 300 MB | `/api/v1/compute` response, under Node's ~512 MB string limit. Over is 413. |
| Cover image upload  | 10 MB  | Project and org images.                                                     |
| Remote `.gh` fetch  | 30 s   | Deadline on fetching a definition from a URL.                               |

**Set `BODY_SIZE_LIMIT`.** Unset, adapter-node falls back to 512 KB and every upload returns 413; `256M` is only the value the scaffold seeds. Use raw bytes or a single `K`/`M`/`G` suffix: `256mb` throws on boot. `Infinity` is accepted and removes the cap on every route, so don't use it in production.

Concurrency is not an env var. Selva reads the compute server's active child count at connect and after solves, and falls back to `1` if the probe fails or reports `0`. Change it with `--childcount` on the compute server. Cache budgets are in [Caching](../concepts/caching.md).

## Guard on remote-definition URLs

A user-supplied definition URL could point at your internal network or the cloud metadata endpoint (SSRF). `packages/server/src/compute/safe-url.ts` checks before any fetch. It first checks the URL text with no DNS: `http(s)` only, not `localhost`, and no integer, octal, hex or short-form encoding of a blocked IP. It then resolves the name and rejects the URL if any resolved address is blocked.

Blocked: `0.0.0.0/8`, loopback, `10/8`, `172.16–31`, `192.168/16`, `fc00::/7`, and link-local (`169.254/16` including `169.254.169.254`, `fe80::/10`). Every rejection returns the same `Remote definition URL is not allowed`; the reason is logged server-side. DNS rebinding between check and fetch is not closed.

Rhino.Compute _server_ URLs, which admins set in `/admin/compute`, get a narrower check on save: `http(s)` only, and link-local refused. Loopback and private ranges stay allowed because that is where a compute server usually lives.

## Who can put code on Compute

A definition's script components (C#, Python, VB) run on the Compute server with its process rights, on upload and every solve. Anyone who gets a definition onto Compute can run code there:

- **Anyone who can create a definition** (project owners and editors; on a commons project, anyone who reaches it).
- **Anyone with an API token scoped `upload` or `write`**, such as the Grasshopper plugin ([Signing in from apps](../../packages/build/signing-in-from-apps.md)). A token reaches only what its owner could from the browser.
- **Anyone who can solve a remote definition**: any signed-in user or org-wide `solve` token can pass a `definitionUrl`. The [URL guard](#guard-on-remote-definition-urls) protects your network, not Compute from the file's scripts.

Selva doesn't sandbox scripts. Run Compute on its own machine with an unprivileged account, no Selva database credentials, `SELVA_*` keys or cloud credentials, and only the network access definitions need.

## Secrets

Two required keys, generated by `npx @selvajs/cli` at scaffold time.

| Key                 | Protects                                                                                        | Format                                               |
| ------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `SELVA_HMAC_KEY`    | Signs session cookies (local provider), OAuth/MCP client ids and codes, and solve-event tokens. | ≥ 32 characters.                                     |
| `SELVA_AT_REST_KEY` | AES-256-GCM encryption of the Rhino.Compute API key (on disk and in DB).                        | 64-char hex, or base64 decoding to exactly 32 bytes. |

Under `supabase`, sessions are Supabase JWTs, so the HMAC key signs no sessions. `SupabaseDataProvider` refuses to start without the at-rest key. A key mismatch is caught at boot and shown in admin system health. The at-rest key guards against leaked backups, not an attacker inside the running process.

Share-link, invite and API tokens are stored as an unkeyed SHA-256 of a 256-bit random token, so neither key is needed to resolve them. Tokens created before that change were stored as an HMAC under `SELVA_HMAC_KEY`; they keep resolving while the key that hashed them is `SELVA_HMAC_KEY` or `SELVA_HMAC_KEY_PREVIOUS`.

`selva config show` and the Configuration section of `/admin/system` show each key's fingerprint, so two machines can be compared without either key leaving them.

### Rotating a key

```bash
npx selva keys rotate hmac            # or at-rest
npx selva restart
```

The old key moves to `SELVA_HMAC_KEY_PREVIOUS` (or `SELVA_AT_REST_KEY_PREVIOUS`), so nothing stops working. At boot the app re-seals stored compute API keys under the new at-rest key.

The overlap is bounded: `keys rotate` also writes `<KEY>_PREVIOUS_EXPIRES`, 30 days out, and the app stops accepting the previous key at that moment on its own. A rotation is meant to limit how long a key that leaked unnoticed stays useful, so the old key doesn't get to live on. `/admin/system` and `selva doctor` count down to the deadline, and flag a previous key set by hand without one. To end the overlap early, or to tidy `.env` once it has passed:

```bash
npx selva keys rotate hmac --finish
npx selva keys rotate at-rest --finish  # once /admin/system shows no API key on the previous key
```

Whenever the overlap ends, MCP clients registered before the rotation register again, and tokens stored under the old key before unkeyed hashing stop resolving. Sessions it signed last 8 hours at most.

For a key that has leaked, `selva keys rotate <key> --leaked` replaces it and drops the old one at once. Dropping the old `SELVA_HMAC_KEY` without an overlap:

- **Sessions (local provider only):** everyone signs in again.
- **OAuth/MCP clients:** registered clients and live authorization codes stop working. Clients register and connect again.
- **Tokens stored before unkeyed hashing** (share links, invites, API tokens): read as invalid. Mint new ones.
- **Solves in flight:** their live-event tokens stop verifying. They end within the solve deadline anyway.

Dropping the old `SELVA_AT_REST_KEY` without an overlap makes stored API keys unreadable; re-enter them at `/admin/compute`. `--leaked` lists the `.env` backups that still hold the old key: delete them if it leaked.

## Cookies and transport

- **Cookies** are `Secure`, `httpOnly` and `sameSite=lax` in production. An `http://` `ORIGIN` drops `Secure`, since a browser discards a Secure cookie over plain HTTP and login would silently fail. `ALLOW_INSECURE_COOKIES=true` or `=false` overrides that either way.
- **`ORIGIN`** must be your public address when behind a proxy (`https://your-domain.com`, no trailing slash). Otherwise form POSTs fail with "Cross-site POST form submissions are forbidden".
- **`HOST`** defaults to `0.0.0.0`; the scaffold sets `127.0.0.1` for header auth or when an origin is given. Under header-auth the app **must** be reachable only through the trusted proxy (bind `127.0.0.1`), and the proxy must authenticate every request and **overwrite** inbound `SELVA-*` headers. Selva never strips them and doesn't check at runtime.

## Logging and personal data

The logger redacts by field name only, at the top level and one level down: `token`, `sessionToken`, `refreshToken`, `apiKey`, `api_key`, `password`, `authorization`, `Authorization`, `cookie`, `secret`. Nothing deeper, and no personal data such as emails. The console fallback used when `pino` isn't installed redacts the same names. Log identifiers (`eventType`, `actorId`, `userId`), never whole objects: logs are where erasure can't reach. See [data privacy](../concepts/data-privacy.md).
