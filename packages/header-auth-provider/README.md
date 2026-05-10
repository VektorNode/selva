# @selvajs/header-auth-provider

Forward-auth provider for Selva. Trusts identity headers set by an upstream
reverse proxy (Caddy `forward_auth`, oauth2-proxy, Authelia, Pomerium,
Traefik forward-auth, …).

**Auth-only.** No data store, no storage, no permissions. Pair with whatever
data provider you want — `@selvajs/local-provider` for filesystem JSON,
`@selvajs/supabase-provider` for Postgres, etc.

---

## ⚠ DO NOT DEPLOY THIS WITHOUT READING THIS SECTION ⚠

This provider trusts the headers it reads from incoming requests. There is
**no cryptographic verification.** Anyone who can reach the app process
directly can spoof `SELVA-UserPrincipalName: ceo@company.com` and become
the CEO.

The deployment IS the security boundary. You **must** ensure all three:

1. **Network isolation.** The app process is reachable ONLY through the
   trusted proxy. Bind to `127.0.0.1`, firewall the port, or use a Unix
   socket. If a curl from outside the proxy can hit the app, you're cooked.

2. **Proxy-side auth.** The proxy authenticates the user against the IdP
   (Microsoft Entra, Google Workspace, Okta, …) on every request, or
   maintains a session that does. If `forward_auth` lets unauthenticated
   requests through, you're cooked.

3. **Header scrubbing.** The proxy STRIPS any `SELVA-*` headers from the
   inbound request before it adds its own. Otherwise a malicious browser
   sends `SELVA-UserPrincipalName: admin@company.com` and the proxy passes
   it through alongside the real one.

**There is no runtime check that catches a misconfiguration.** Run the
self-test in the Verification section after every deployment change.

---

## How it works

```
                     ┌──────────────────────────────────────┐
                     │   Microsoft Entra / Okta / Google    │
                     └──────────────┬───────────────────────┘
                                    │ OIDC
                  ┌─────────────────┴─────────────────┐
   user ────────► │  Caddy (or oauth2-proxy / etc.)   │
                  │  - authenticates user             │
                  │  - strips inbound SELVA-* headers │
                  │  - sets trusted SELVA-* headers   │
                  └─────────────────┬─────────────────┘
                                    │ http://127.0.0.1:3000
                                    ▼
                  ┌───────────────────────────────────┐
                  │   Selva (header-auth-provider)    │
                  │  - reads SELVA-UserPrincipalName  │
                  │  - looks up in allowlist          │
                  │  - materializes email/displayName │
                  │    from headers on first sight    │
                  └───────────────────────────────────┘
```

Admin pre-allowlists a UPN (no password collected). On the user's first
visit through the proxy, the provider matches the UPN against the allowlist,
fills in `email` / `displayName` from the matching headers, and the user is
authenticated. On subsequent visits the same lookup runs — no session
cookie, no token, no state in the browser beyond what the proxy already has.

---

## Configuration

### `selva.config.ts`

```ts
import { defineConfig } from '@selvajs/platform';
import * as local from '@selvajs/local-provider';
import { HeaderAuthProvider } from '@selvajs/header-auth-provider';

export default defineConfig((env) => ({
  tenancy: 'single' as const,
  flags: { /* … */ },

  auth: HeaderAuthProvider.fromEnv(env),
  data: local.LocalDataProvider.fromEnv(env),
  storage: local.LocalStorageProvider.fromEnv(env)
}));
```

### Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `HEADER_AUTH_DATA_DIR` | yes¹ | — | Directory holding `header-allowlist.json` (the pre-provisioned UPN list). |
| `DATA_PATH` | — | — | Fallback when `HEADER_AUTH_DATA_DIR` is unset. Convenient when paired with `@selvajs/local-provider`. |
| `HEADER_AUTH_UPN_HEADER` | — | `SELVA-UserPrincipalName` | Header carrying the user's UPN. |
| `HEADER_AUTH_EMAIL_HEADER` | — | `SELVA-Email` | Header carrying the user's email. |
| `HEADER_AUTH_DISPLAY_NAME_HEADER` | — | `SELVA-DisplayName` | Header carrying the user's display name. |
| `HEADER_AUTH_LOGOUT_URL` | — | `null` | Where `/logout` redirects after destroying the local session. **Set this to your IdP's sign-out URL** — otherwise the proxy will silently re-authenticate the user on the next request. |

¹ Either `HEADER_AUTH_DATA_DIR` or `DATA_PATH` must be set.

---

## Caddyfile example (Microsoft Entra ID via `forward_auth`)

This assumes you already have an Entra-aware forward-auth helper running
(e.g. `caddy-security`, `traefik-forward-auth`, or a tiny custom service
that issues a session cookie after OIDC). The example shows the **header
hygiene** that matters — adapt the `forward_auth` block to your specific
IdP plugin.

```caddyfile
app.example.com {
    encode gzip

    # 1. Strip any inbound copies of the trusted headers BEFORE forward_auth
    #    runs. Without this, a browser can send its own `SELVA-*` headers
    #    and the auth helper's copies are appended — Selva sees both, and
    #    Headers.get() returns the FIRST one.
    request_header -SELVA-UserPrincipalName
    request_header -SELVA-Email
    request_header -SELVA-DisplayName

    # 2. Authenticate via forward-auth helper. Replace with your stack
    #    (caddy-security, traefik-forward-auth, oauth2-proxy, …). The
    #    helper must populate the SELVA-* headers on success.
    forward_auth http://127.0.0.1:9091 {
        uri /verify
        copy_headers SELVA-UserPrincipalName SELVA-Email SELVA-DisplayName
    }

    # 3. Reverse-proxy to Selva, bound to localhost.
    reverse_proxy 127.0.0.1:3000
}
```

And in `ecosystem.config.cjs` (PM2) or your systemd unit, bind Selva to
loopback only:

```
HOST=127.0.0.1
PORT=3000
```

If `curl http://<server-public-ip>:3000/` succeeds from another machine,
your network isolation is broken — fix the firewall before going live.

---

## Bootstrap (the first admin)

The chicken-and-egg: an admin pre-allowlists users, but there's no admin
yet on a fresh install.

Use the existing **invite link** mechanism. Generate a one-shot invite from
the CLI / a setup script, browse to it through Caddy, and the
`/accept-invite` page allowlists you and signs you in via the next request.
The accept-invite UI auto-detects this provider and skips the password
form.

```bash
# After deploying, generate a bootstrap invite:
node -e "
  import('./packages/compute-app/build/index.js').then(...)
" # see docs/QuickStart.md for the seeded-invite recipe
```

---

## Adding users (post-bootstrap)

Admin → **Users → New user** → enter the UPN in the email field. For M365 /
Entra deployments the UPN usually IS the email
(`alice@company.onmicrosoft.com`); for other IdPs document the format in
your onboarding.

The row sits empty (no `email`, no `displayName`) until the user first
visits — at that point the provider materializes those fields from the
matching headers.

---

## Logout

`/logout` destroys Selva's local session and redirects to
`HEADER_AUTH_LOGOUT_URL`. Without that, the proxy re-authenticates the user
on the very next request and "logout" becomes a no-op the user can't escape.

Microsoft Entra logout URL pattern:

```
HEADER_AUTH_LOGOUT_URL="https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/logout?post_logout_redirect_uri=https://app.example.com/login"
```

---

## Verification (run after every deployment change)

From a machine OUTSIDE your network, with the proxy running:

```bash
# 1. Direct hit must fail — if this works, network isolation is broken.
curl -v http://<server-public-ip>:3000/admin
# Expected: connection refused / timeout / 403 from firewall.

# 2. Spoofed header must fail — if this works, the proxy isn't stripping.
curl -v -H "SELVA-UserPrincipalName: attacker@example.com" \
  https://app.example.com/admin
# Expected: redirected to IdP login, NOT logged in as attacker.

# 3. Real flow must work.
# Open https://app.example.com in a browser, complete IdP login, land on /admin.
```

If any of these don't behave as expected, **do not put the deployment in
front of real users until they do.**
