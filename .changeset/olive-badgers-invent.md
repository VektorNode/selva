---
'@selvajs/local-provider': patch
'@selvajs/cli': patch
'@selvajs/server': minor
'@selvajs/selva': patch
---

Close the six findings from the app security audit.

**One setting needs an operator's hand — the code cannot apply it.**

`ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH=<proxy count>` were already documented but unset. Without them `getClientAddress()` returns the socket peer, which behind a reverse proxy is `127.0.0.1` for every request from every user — so the login limiter had exactly one bucket. Five failed logins from anywhere returned 429 to everyone, and only a successful login clears a bucket, which nobody could then reach. Cheap unauthenticated denial of service against a whole instance, renewable indefinitely.

Four changes cover the gap until an operator sets them. A per-account failure counter now runs alongside the per-IP one, keyed on the normalized email — per-IP bounds nothing against an attacker spread across source addresses, and per-account is what protects a targeted user. The app logs a warning the first time a login arrives from loopback with `ADDRESS_HEADER` unset. `selva doctor` reports the pair as red when `ORIGIN` is set (a proxy is in play) and `ADDRESS_HEADER` is not, and yellow when `X-Forwarded-For` is trusted without an `XFF_DEPTH` to say which hop is real. And `selva proxy` prints the two lines to add after it configures Caddy, since that is the moment the operator creates the condition.

Doctor stays quiet when `ORIGIN` is unset. On a directly-reachable app these settings are a footgun — `X-Forwarded-For` is client-supplied, so trusting it there lets any caller choose their own rate-limit bucket.

Caddy needs no change: `reverse_proxy` already sends the header. Only the app's willingness to trust it was missing.

**The rest carry no deployment impact.**

A compute `serverUrl` saved at `/admin/compute` is validated: `http`/`https` only, and never the link-local range. That URL is fetched server-side on every status probe and every solve, so an unfiltered one lets whoever holds `manage_compute` point the app at `http://169.254.169.254/latest/meta-data/` and read the host's own cloud credentials. Loopback and LAN addresses stay allowed, since running compute on `localhost` or an internal box is the ordinary self-hosted layout — blocking those would break working deployments and push operators toward disabling the guard entirely. `169.254.0.0/16` is the one range no legitimate compute server uses.

`/admin/*`, `/setup` and `/login` are no longer framable. Selva apps are built for iframe embedding and app routes stay that way, but that tradeoff was being applied uniformly, leaving an authenticated instance admin open to UI-redress. `applySecurityHeaders` gained an opt-in `denyFraming` option — additive, so existing callers are unaffected.

The OAuth callback checks a CSRF nonce before exchanging the code. It is a GET that mints a session cookie, and SvelteKit's origin check only covers form POSTs, so an attacker could capture a `?code=` from their own flow and induce a victim to load it — silently signing the victim into the attacker's account, where everything they then do is visible. Supabase does not expose the real OAuth `state` and `exchangeOAuthCode` takes only `code`, so the nonce is minted at `/auth/supabase/start`, carried on the callback URL, and compared against a short-lived cookie. Single-use, cleared on failure as well as success.

`auth-users.json` and `compute.config.json` are written `0600` in a `0700` directory. The shared write helper set no mode, and `rename` preserves the temp file's umask bits, so PBKDF2 password hashes were landing world-readable — any other local user or co-tenant service on the host could copy and crack them offline. No-op on Windows.

API 500s log through pino instead of raw `console.error`. Provider adapters stash connection details on `cause`, and handing that object to stdout puts it somewhere redaction never runs and erasure cannot follow.

`SELVA_HMAC_KEY` now refuses the `.env.example` placeholder. At 41 characters it cleared the 32-char minimum, so an operator who copied the file without rotating booted with a session-signing key that is public in this repo — every token forgeable. `selva doctor` caught it, but nothing forces anyone to run doctor.
