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

The identity here is a **UPN** — user principal name, the `user@domain` string
Entra uses to name an account. It usually looks like an email address and is
often the same string, but it is the directory's own identifier, not a mailbox.

An admin adds a UPN to the allowlist ahead of time; no password is collected. On
the user's first visit through the proxy, the provider matches the UPN against the allowlist,
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
	flags: {/* … */},

	auth: HeaderAuthProvider.fromEnv(env),
	data: local.LocalDataProvider.fromEnv(env),
	storage: local.LocalStorageProvider.fromEnv(env)
}));
```

### Environment variables

| Var                               | Required | Default                   | Purpose                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HEADER_AUTH_DATA_DIR`            | yes¹     | —                         | Directory holding `header-allowlist.json` (the pre-provisioned UPN list).                                                                                                                                                                                                                                     |
| `DATA_PATH`                       | —        | —                         | Fallback when `HEADER_AUTH_DATA_DIR` is unset. Convenient when paired with `@selvajs/local-provider`.                                                                                                                                                                                                         |
| `HEADER_AUTH_UPN_HEADER`          | —        | `SELVA-UserPrincipalName` | Header carrying the user's UPN.                                                                                                                                                                                                                                                                               |
| `HEADER_AUTH_EMAIL_HEADER`        | —        | `SELVA-Email`             | Header carrying the user's email.                                                                                                                                                                                                                                                                             |
| `HEADER_AUTH_DISPLAY_NAME_HEADER` | —        | `SELVA-DisplayName`       | Header carrying the user's display name.                                                                                                                                                                                                                                                                      |
| `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`  | see²     | —                         | UPN/email of the user who should be auto-allowlisted as the first instance admin on a fresh install. Read by the `@selvajs/selva` runtime (not by this provider directly) and turned into a one-shot `BootstrapAllowlistPolicy`. Becomes inert as soon as any instance admin exists. See **Bootstrap** below. |

¹ Either `HEADER_AUTH_DATA_DIR` or `DATA_PATH` must be set.

² Required for `SELVA_TENANCY=multi`. Optional for `SELVA_TENANCY=single`: leave it unset to get "first proxy-authed visitor wins" (fine for self-hosted fresh installs); set it to lock the bootstrap to a specific UPN/email.

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
    #    and the auth helper's copies are appended — `Headers.get()` returns
    #    them joined with `, ` (e.g. "attacker@x.com, real@y.com"), which
    #    won't match any allowlisted UPN. So the practical failure mode is
    #    "no one can log in" rather than "anyone can spoof", but you do NOT
    #    want to rely on that — strip the headers and keep the trust path clean.
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
yet on a fresh install. Forward-auth deployments make this worse — there's
no `/setup` form to fill in (no password, no OAuth callback), so the very
first proxy-authed visitor would normally just bounce off the strict
"must be pre-allowlisted" check.

The runtime resolves this automatically via a one-shot **bootstrap
allowlist policy**. On every authed request, `@selvajs/selva` checks
whether an instance admin already exists; until one does, it asks the
provider whether the incoming UPN/email matches `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`.
A match auto-allowlists the user and grants them every platform permission
in the same request. The next visit is a normal allowlisted login; the
bootstrap window has closed.

```text
fresh install → unrecognized UPN arrives at proxy
   ↓
hasInstanceAdmin? ── no ──► UPN/email == BOOTSTRAP_INSTANCE_ADMIN_EMAIL?
   │                            │
   │ yes                        ├── yes → auto-allowlist + grant admin
   │                            └── no  → reject (null user)
   ▼
strict allowlist-only path (policy returns false from now on)
```

Tenancy interactions:

- **`SELVA_TENANCY=single` + env var unset** → first proxy-authed visitor
  wins. Fine for self-hosted fresh installs where you control who can
  reach the proxy at all.
- **`SELVA_TENANCY=single` + env var set** → only that UPN/email can
  bootstrap. Use this if multiple people might hit the box during setup.
- **`SELVA_TENANCY=multi`** → the env var is **required**. Without it,
  the first random multi-tenant signup would silently become Selva staff.

Doubles as the break-glass recovery path: if you lose admin to a backup
restore or migration drift, set the env var, demote/delete every
`instance_admin` row in your permission store, and the next visit by the
named user re-bootstraps you.

Custom runtimes that wire `HeaderAuthProvider` themselves can call
`provider.setBootstrapAllowlistPolicy(...)` directly — see the
`BootstrapAllowlistPolicy` type for the contract.

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

There is no Selva-side logout under this provider. Identity rides on every
request via the proxy headers, so there is no session, cookie, or token for
Selva to destroy — anything it cleared would be re-supplied by the proxy on
the very next request. The UI hides the logout button accordingly.

Sign-out is the proxy / IdP's responsibility. Point users at your IdP's
sign-out URL (e.g. the Microsoft Entra `/oauth2/v2.0/logout` endpoint) from
your own portal, or rely on whatever session-management UI the proxy already
provides.

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
