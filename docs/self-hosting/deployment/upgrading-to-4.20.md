---
title: Upgrading to 4.20
order: 6
published: true
description: 'Moving a 4.19 deployment to 4.20: the .env changes that stop boot, settings that moved to the compute server, and what changes for header auth.'
---

# Upgrading to 4.20

For a deployment on 4.19 installed with `@selvajs/cli`, on the local provider, with local or header (Entra) auth. Supabase deployments have extra database migrations, not covered here.

## Checklist

1. **Back up** `.env` and the whole `DATA_PATH` folder (and `HEADER_AUTH_DATA_DIR` if you set it apart).
2. **Check `.env` for values that now stop boot** (see [Strict `.env` parsing](#strict-env-parsing)). The 4.19 CLI has no `config` command, but the new one runs against a 4.19 install: `npx @selvajs/cli@latest config show` in the deployment folder reads `.env` against the new rules without touching the app. Or check by hand:
   - `SELVA_HMAC_KEY` set and at least 32 characters, on every auth provider, header auth included.
   - `SELVA_AT_REST_KEY` exactly 64 hex characters or 32 bytes of base64, with no stray characters.
   - Every `SELVA_FLAG_*`, `ALLOW_INSECURE_COOKIES` and `SMTP_SECURE` is one of `true false 1 0 yes no on off`.
   - `ORIGIN`, `SENTRY_DSN` and `SELVA_EVENT_CALLBACK_ORIGIN`, if set, are absolute URLs.
3. **Update the Rhino.Compute fork first** with the updater in [Rhino Compute setup](../get-started/rhino-compute.md), so it answers `/limits`. **Move long solve deadlines to Rhino.Compute.** If you set `COMPUTE_SOLVE_DEADLINE_MS`, set `--timeout` (`RHINO_COMPUTE_TIMEOUT`) on the compute server instead. See [Compute limits come from the server](#compute-limits-come-from-the-compute-server).
4. **Update:** `npm run update` (or `npx selva update`). It stops the app, updates `@selvajs/cli` and `@selvajs/selva`, and starts it again.
5. **If the app doesn't come up:** `npx selva config show` names each bad value. Fix it with `npx selva config set KEY=VALUE`, then `npm run restart`.
6. **Clean `.env`:** `npx selva migrate --dry-run`, then `npx selva migrate`. It removes retired keys and keeps every setting's meaning. It also strips the copied template comments from `.env`; short notes directly above a setting stay.
7. **Header auth only:** update the Caddyfile for the new bypass routes, and check the Caddy and oauth2-proxy versions. See [Header auth (Entra)](#header-auth-entra).
8. **Check `/admin/system`** (config report, key status) and **`/admin/compute`** (what each compute server reports).
9. **Update `Selva.gha`** on every machine that edits definitions. See [Grasshopper plugin](#grasshopper-plugin).

## Breaking

### Strict `.env` parsing

4.19 read a bad value as "off" or the default. 4.20 validates every setting at boot, and a bad value on a security-relevant setting throws `Invalid configuration: <KEY> <problem>` and the process exits. Under pm2 it shows as a crash loop; `npm run logs` prints the key.

What stops boot:

- `SELVA_HMAC_KEY` missing or shorter than 32 characters. Before, only the local auth provider checked it; now every provider does.
- `SELVA_AT_REST_KEY` that isn't 32 bytes as 64 hex characters or base64. Padding or a passphrase that only looks like base64 is refused.
- A boolean that isn't `true|false|1|0|yes|no|on|off` (case-insensitive). `SELVA_FLAG_ENABLE_SHARING=enabled` used to mean off.
- A URL setting that isn't an absolute URL, an out-of-range `PORT`, a `SELVA_TENANCY` other than `single|multi`, `SIGN_IN_MAX_AGE_DAYS` that isn't a whole number.
- `SMTP_PORT` out of range.

Tunables (cache sizes, queue depth, `LOG_LEVEL`) still warn and fall back to the default.

Code: `packages/server/src/config/settings.ts`, `packages/selva/src/lib/server/config/settings.ts`, `boot.server.ts`.

### Retired env vars

These are ignored. Boot logs `Retired env var, ignored: run selva migrate` for each one still set, and `selva migrate` removes them.

| Key                                  | Now                                                        |
| ------------------------------------ | ---------------------------------------------------------- |
| `COMPUTE_SOLVE_DEADLINE_MS`          | `--timeout` on the compute server                          |
| `MAX_SOLVE_DURATION_MS`              | same                                                       |
| `COMPUTE_REUSE_DEFINITION_CACHE`     | on whenever the compute server reports `/limits`           |
| `COMPUTE_CACHE_ERRORED_SOLVES`       | removed; Selva's own cache still keeps errored solves      |
| `COMPUTE_REQUEST_MAX_BYTES`          | fixed at 256 MB                                            |
| `COMPUTE_RESPONSE_MAX_BYTES`         | fixed at 300 MB                                            |
| `COMPUTE_RATE_LIMIT_WINDOW_MS`       | fixed at 100 s (`COMPUTE_RATE_LIMIT_MAX` still applies)    |
| `MAX_IMAGE_FILE_SIZE_BYTES`          | fixed at 10 MB                                             |
| `REMOTE_DEFINITION_FETCH_TIMEOUT_MS` | fixed at 30 s                                              |
| `REMOTE_DEFINITION_CACHE_TTL_MS`     | fixed at 5 min                                             |
| `DEFINITION_CACHE_TTL_MS`            | fixed at 5 min                                             |
| `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE`   | `SELVA_FLAG_COMPUTE_DEBUG=verbose` (`migrate` rewrites it) |

If you had raised one of the fixed caps, it is back at the value shown. `COMPUTE_DEFINITION_BYTE_CACHE_MB` and `COMPUTE_RESPONSE_CACHE_MB` still work as aliases of `COMPUTE_DEFINITION_CACHE_MB` and `COMPUTE_SOLVE_CACHE_MB`, with a boot warning.

### Compute limits come from the compute server

Selva no longer sets a solve's deadline or whether to reuse Rhino.Compute's cached definition. It asks each server (`GET /limits`) and shows the answer on `/admin/compute`.

- **Server that reports `/limits`** (a current VektorNode fork build): the deadline is its `--timeout` plus 5 s, capped at one hour, and the cached definition is reused.
- **Server that doesn't** (McNeel's stock build, older fork builds): the deadline is 100 s, and Selva **re-uploads the `.gh` on every solve**, which 4.19 did not do by default. Large definitions get slower. Update the fork to fix it.

A deployment that ran solves longer than 100 s through `COMPUTE_SOLVE_DEADLINE_MS` now times out at 100 s until the compute server reports a longer `--timeout`. Raise the reverse proxy's read timeout to match.

The fork ships as the latest CI build of its `8.x.selva` branch, not as tagged releases. Re-run the updater from [Rhino Compute setup](../get-started/rhino-compute.md) on the compute machine before updating Selva; any `8.x.selva` build from November 2026 on answers `/limits`. `/admin/compute` shows what yours reports.

Code: `packages/solve/src/server/server-limits.ts`, `packages/compute/src/grasshopper/server/compute-server-stats.ts`.

### Compute server URLs that redirect

Selva no longer follows a redirect from Rhino.Compute: following one sent the `RhinoComputeKey` header to the redirect target. A server URL that redirects (for example `http://` to `https://`) now fails with a message naming the target. Set the server URL on `/admin/compute` to that target.

### Saving compute config

Saving on `/admin/compute` now refuses:

- a server id that isn't a UUID. Servers added through the UI already have one; only a hand-edited entry in `DATA_PATH/compute.config.json` needs fixing.
- `timeoutMs` outside 1000–300000 and `retryCount` outside 0–5.
- a save that leaves the API key blank for a server whose stored key can't be decrypted (409). Restore the old `SELVA_AT_REST_KEY` or re-enter the key.
- a changed server URL with the API key left blank (409). Re-enter the key, or clear it, when you move a server.

Stored keys in the old `enc:v1:` format still decrypt and are rewritten as `enc:v2:` the next time that server is saved. Nothing to do.

### Viewer follows "Compute render" only

The 3D viewer and display meshes in Selva now follow the definition's `viewerOptions.enableRemote` (Compute render) alone. A definition with only Local render on opens **without a viewer**. Turn on Compute render in the plugin and upload a new version.

## Header auth (Entra)

**An existing Entra setup keeps signing people in unchanged.** Header names and defaults (`SELVA-UserPrincipalName`, `SELVA-Email`, `SELVA-DisplayName`), `HEADER_AUTH_*` settings, the allowlist file format and the bootstrap rule are the same. Verified in `packages/providers/header-auth/src/`.

What changed:

- **Email fallback is narrower.** When the UPN header matches no allowlist row, Selva still falls back to the email header, but now only matches rows whose UPN is that address (people pre-allowlisted by email). It no longer matches the `email` column, which proxy headers write. A user whose Entra UPN changed since their first sign-in, and who was matched through that column, is refused. Fix their row's `upn` in `header-allowlist.json`.
- **New routes must skip `forward_auth`** if you want API tokens, MCP clients or the Grasshopper plugin's "Upload to Selva": requests with `Authorization: Bearer selva_*`, `/mcp`, `/.well-known/oauth-*`, `/oauth/register` and `/oauth/token`. Without the bypass oauth2-proxy redirects them to the Entra login and they fail; browser use is unaffected. The working Caddyfile is in [header-auth-entra.md](../providers/header-auth-entra.md).
- **Live solve progress** posts from Rhino.Compute to `/api/v1/solve-events/<id>`. Behind `forward_auth` those posts were refused, in 4.19 too, so the page showed no progress (solves still finished). The same Caddyfile lets them through; the route checks a per-solve token.
- **Proxy versions:** use Caddy 2.11.2 or later and oauth2-proxy 7.15.5 or later. Older versions have header-passthrough and log-leak advisories, linked from the Entra guide.
- Optional: `SIGN_IN_MAX_AGE_DAYS`. Under header auth every request through the proxy counts as a sign-in, so an API token whose owner hasn't come through the proxy for that many days is revoked. This is what retires the keys of someone disabled in Entra. Off by default.

## Local data

**Local data on disk is read as-is; there is no migration step.** Verified in `packages/providers/local/src/`:

- Existing JSON files keep their shape. New fields are optional (`sourceDocumentId` on definitions). API tokens go in a new `DATA_PATH/api-tokens.json`.
- Sessions, invite links and share links issued by 4.19 keep working. New tokens are stored as unkeyed SHA-256; old ones still resolve under the current or previous `SELVA_HMAC_KEY`.
- Writes to each JSON file are now serialized, so concurrent saves no longer lose an invite, grant, share link or compute server.
- An org whose slug is now reserved (`docs`, `mcp`, `oauth`) still loads and works: the reserved list is checked only when an org is created or its slug is changed, and no route reads an org by slug.
- The provider now caches the org, definition, user-data and `auth-users.json` files in memory. Stop the app before hand-editing one, or the next write overwrites your edit. `header-allowlist.json` is still read on every request, so editing it live is fine.
- Erasing a user now also removes their invites, memberships, grants, share links and API tokens. Their orgs, projects and definitions stay, under the erased-actor id.

## Behaviour changes worth knowing

**Config and keys**

- `npx selva config show` and `/admin/system` list what `.env` sets, what is wrong, unknown keys and what changed since the last boot. `selva config set KEY=VALUE` edits one line with a backup.
- `selva keys rotate hmac|at-rest` keeps the old key working for 30 days as `<KEY>_PREVIOUS`. Changing a key by hand without that still breaks sessions or stored compute API keys.
- An `http://` `ORIGIN` drops the `Secure` cookie flag by itself; `ALLOW_INSECURE_COOKIES` is only needed to override.
- `selva setup-proxy` writes `max_size 256MiB`. Caddy reads `256mb` as 10^6-byte megabytes, slightly under the app's cap, so change it by hand in an older Caddyfile.
- SvelteKit 3 underneath. `.env`, the start command and the proxy setup are unchanged; Selva applies `ORIGIN` itself.

**API tokens, MCP, OAuth** (new, on by default)

- Tokens are created at `/team/tokens`. Instance admins can create any key; others need the `manage_api_tokens` platform permission (Admin → Users), except upload-only keys, which anyone who can add definitions to a project may hold. Removing that permission turns the person's keys off.
- `/mcp` serves MCP clients, which sign in through `/oauth/authorize`. `MCP_ALLOWED_ORIGINS` adds browser origins.
- 600 requests per token per minute (`API_TOKEN_RATE_LIMIT_MAX`, 0 turns it off). Browser sessions are not charged.
- Disabling a user revokes all their keys; removing a member revokes their keys in that org.

**Access and admin**

- Deleting the only owner of an org answers 409: make someone else owner or delete the org first.
- Only the org owner can change an owner's or admin's permissions. Member role changes need a browser session, not an API key.
- Accepting an invite checks the inviter is still enabled and in the org.
- Share links created without an expiry now expire after 90 days. Existing links keep theirs.
- On commons projects, uploading needs view access; with `SELVA_FLAG_ALLOW_CROSS_ORG_PUBLIC` off, outsiders can't upload there.
- Uploaded images over 60 megapixels are refused; stored images fit within 1200 px on both sides.

**Solving**

- A stored definition solves with the inputs from its version's schema; inputs in the request body are ignored, and number bounds are enforced on the server. A version whose schema can't be read answers 503.
- A value that can't be coerced (text in a number input) is left out, so Grasshopper keeps its own value. 4.19 sent `0` or the minimum. `generic` inputs now reach Grasshopper.
- Restarts and updates no longer wait out pm2's `kill_timeout`. Open tabs show "Selva has been updated" with a Reload button.

## Grasshopper plugin

- Selva 4.20 reads definitions saved by the 4.19-era plugin (0.22, schema 2.15) unchanged.
- The current plugin (0.24) writes schema 2.19: geometry inputs, buttons, value-list icons and thumbnails, the night look. Selva leaves geometry inputs and buttons out and solves with the definition's own values there.
- **Update the plugin on every machine that edits a shared `.gh`.** An older plugin saving a file from a newer one drops its geometry inputs and buttons, and refuses a schema with value-list pictures (needs 0.24.0).
- "Upload to Selva" in the plugin needs a token-capable instance; behind header auth, also the Caddy bypass above.

Plugin-to-app version pairing beyond this is not enforced by either side, and was not tested here.
