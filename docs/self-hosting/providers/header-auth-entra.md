---
title: Header-auth & Entra
order: 3
published: true
description: 'Trust a reverse proxy for identity: front Selva with Entra SSO via oauth2-proxy.'
---

# Header-auth (Entra, Okta, Google Workspace…)

`@selvajs/header-auth-provider` is an **auth-only** adapter that trusts identity headers set by a reverse proxy (Caddy `forward_auth`, oauth2-proxy, Authelia) in front of Selva. Pair it with [`local`](./local.md) or [`supabase`](./supabase.md) for data and storage.

## ⚠ Security: the deployment IS the boundary

The provider does **no cryptographic verification.** The proxy is the only thing between a stranger and an admin session, and nothing at runtime catches a misconfiguration.

**Read the [`@selvajs/header-auth-provider` README](https://github.com/VektorNode/selva/blob/main/packages/providers/header-auth/README.md) before deploying.** It owns the three requirements (network isolation, proxy-side auth, header scrubbing), the header names, env vars, bootstrap policy, and self-test. This page shows one way to meet them with Entra.

## Prerequisites

Selva running behind a [reverse proxy](../deployment/reverse-proxy.md) (see [Prerequisites](../deployment/prerequisites.md) and the [CLI guide](../get-started/cli.md)), and a domain with an A record pointing at the host.

## Entra SSO via oauth2-proxy + Caddy

```mermaid
flowchart LR
  B[Browser] -->|HTTPS| C[Caddy]
  C -->|forward_auth| O[oauth2-proxy]
  O -->|OIDC| E[Entra]
  C -->|"reverse_proxy + SELVA-* headers"| S["Selva 127.0.0.1:3000"]
```

Replace `[your-domain]` and `admin@corp.com` throughout.

### Part 1: Entra app registration

1. **App registrations → New registration** (single tenant). Copy the **Application (client) ID** and **Directory (tenant) ID**.
2. **Certificates & secrets → New client secret.** Copy the value now; it is shown once.
3. **Authentication → Add platform → Web** (not SPA). Redirect URI, exact, no trailing slash:
   ```
   https://[your-domain]/oauth2/callback
   ```

The default `User.Read` permission is enough.

### Part 2: Install oauth2-proxy

Download a [release](https://github.com/oauth2-proxy/oauth2-proxy/releases) (v7.6.0 shown), put the binary at `/usr/local/bin/oauth2-proxy`, and generate a cookie secret:

```bash
python3 -c 'import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

### Part 3: oauth2-proxy config

`/etc/oauth2-proxy.cfg` (`chmod 600`):

```ini
provider = "oidc"
oidc_issuer_url = "https://login.microsoftonline.com/<TENANT_ID>/v2.0"
client_id = "<CLIENT_ID>"
client_secret = "<SECRET_VALUE>"
cookie_secret = "<COOKIE_SECRET>"

http_address = "127.0.0.1:4180"
reverse_proxy = true
redirect_url = "https://[your-domain]/oauth2/callback"

oidc_email_claim = "preferred_username"
email_domains = ["*"]
set_xauthrequest = true
skip_provider_button = true

cookie_secure = true
cookie_domains = ["[your-domain]"]
```

### Part 4: oauth2-proxy as a service

`/etc/systemd/system/oauth2-proxy.service`:

```ini
[Unit]
Description=oauth2-proxy
After=network.target

[Service]
ExecStart=/usr/local/bin/oauth2-proxy --config=/etc/oauth2-proxy.cfg
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now oauth2-proxy
```

`www-data` must be able to read the config: `sudo chown www-data /etc/oauth2-proxy.cfg`.

### Part 5: Caddyfile

```caddyfile
[your-domain] {
    encode gzip

    # Strip spoofable identity headers at site scope, before any route runs.
    request_header -SELVA-UserPrincipalName
    request_header -SELVA-Email
    request_header -SELVA-DisplayName
    request_header -X-Auth-Request-User
    request_header -X-Auth-Request-Email
    request_header -X-Auth-Request-Preferred-Username

    # oauth2-proxy's own endpoints bypass forward_auth.
    handle /oauth2/* {
        reverse_proxy 127.0.0.1:4180 {
            header_up X-Real-IP {remote_host}
        }
    }

    # Requests Selva authenticates itself skip forward_auth: anything carrying a
    # Selva API key, the MCP endpoint, and the OAuth endpoints MCP clients call
    # server-to-server. /oauth/authorize is not listed: it needs your sign-in.
    @selfAuthenticated {
        header Authorization "Bearer selva_*"
    }
    handle @selfAuthenticated {
        reverse_proxy 127.0.0.1:3000
    }
    @mcpPublic path /mcp /.well-known/oauth-protected-resource /.well-known/oauth-protected-resource/* /.well-known/oauth-authorization-server /oauth/register /oauth/token
    handle @mcpPublic {
        reverse_proxy 127.0.0.1:3000
    }

    # Everything else: authenticate, map identity onto SELVA-*, proxy to Selva.
    handle {
        forward_auth 127.0.0.1:4180 {
            uri /oauth2/auth
            copy_headers X-Auth-Request-User X-Auth-Request-Email X-Auth-Request-Preferred-Username

            @bad status 401
            handle_response @bad {
                header Location /oauth2/start?rd={http.request.uri}
                respond 302
            }
        }

        request_header SELVA-UserPrincipalName {http.request.header.X-Auth-Request-Preferred-Username}
        request_header SELVA-Email             {http.request.header.X-Auth-Request-Email}

        reverse_proxy 127.0.0.1:3000
    }
}
```

- **Keep the strip lines at site scope.** Inside a `handle`, Caddy runs `request_header` in its own directive order, so a strip below `forward_auth` does not reliably run first. Strip both families: `copy_headers` forwards a client-supplied `X-Auth-Request-*` when oauth2-proxy sets none.
- **`@selfAuthenticated` and `@mcpPublic`** let API tokens and MCP clients skip the Entra session. Drop both if you use neither.
- **`SELVA-DisplayName` is unmapped.** oauth2-proxy has no display-name header, and `X-Auth-Request-User` is an opaque OID. The UI falls back to the email.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

### Part 6: Selva env

```bash
SELVA_AUTH_PROVIDER=header
HOST=127.0.0.1
ORIGIN=https://[your-domain]
BOOTSTRAP_INSTANCE_ADMIN_EMAIL=admin@corp.com
```

`HOST=127.0.0.1` is required, and port 3000 must be closed in the firewall. Leave `HEADER_AUTH_*_HEADER` unset: this Caddyfile maps onto the default `SELVA-*` names. If you forward `X-Auth-Request-*` unchanged, override all three ([details](https://github.com/VektorNode/selva/blob/main/packages/providers/header-auth/README.md#header-names-must-match-what-reaches-selva)).

Run `npm run doctor` in `~/selva` to see the resolved header names, then restart the app.

### Part 7: Test

Run the [provider README's self-test](https://github.com/VektorNode/selva/blob/main/packages/providers/header-auth/README.md#verification-run-after-every-deployment-change) **from outside your network**, and again after any proxy or firewall change. A successful login does not prove the direct-hit and spoofed-header checks pass.

### Troubleshooting

| Symptom                               | Fix                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `invalid keys: cookie_domain`         | Use `cookie_domains = ["..."]` (list)                                         |
| Browser shows plain "unauthorized"    | Add the `handle_response @bad` block                                          |
| `unrecognized directive: redirect`    | Use `header Location ...` + `respond 302` inside `handle_response`            |
| **AADSTS50011** redirect URI mismatch | Make `redirect_url` and the Entra URI identical                               |
| Bounced after login                   | Compare the email in the oauth2-proxy log to `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` |

### Day-2

- **Restrict sign-in:** replace `email_domains = ["*"]` with `authenticated_emails_file`, or use `allowed_groups`.
- **Add users:** allowlist them in **Admin → Users → Allowlist user**, then grant org access in **Team → Members & roles**.
- **Rotate the secret:** create a new one in Entra, update `client_secret`, restart oauth2-proxy.

## Next

- [Providers overview](./overview.md)
- [Get Started](../get-started/overview.md)
