---
title: Header-auth & Entra
group: Providers
order: 3
published: true
description: 'Trust a reverse proxy for identity — front Selva with Entra SSO via oauth2-proxy.'
---

# Header-auth (Entra, Okta, Google Workspace…)

`@selvajs/header-auth-provider` is an **auth-only** adapter that trusts identity headers set by an upstream reverse proxy. Pair it with the IdP your org already uses (Microsoft Entra ID, Okta, Google Workspace) via the proxy, and with any data/storage provider underneath.

## When to use it

- Your org already authenticates through an SSO IdP.
- A reverse proxy (Caddy `forward_auth`, oauth2-proxy, Authelia, Entra) sits in front of the app.

It does auth only. Pair it with [`local`](../providers/local.md) or [`supabase`](../providers/supabase.md) for data and storage.

## ⚠ Security: the deployment IS the boundary

This provider does **no cryptographic verification**; it trusts the headers it reads. Anyone who reaches the app process directly can spoof an identity. You **must** ensure all three:

1. **Network isolation.** The app is reachable _only_ through the trusted proxy (bind `127.0.0.1`, firewall, or Unix socket).
2. **Proxy-side auth.** The proxy authenticates every request against the IdP.
3. **Header scrubbing.** The proxy strips inbound `SELVA-*` headers before adding its own.

There is no runtime check that catches a misconfiguration. Run the README's self-test after every deployment change.

Full setup, header names, proxy examples, and the self-test live in the header-auth-provider README.

## Prerequisites

Selva already scaffolded and running with `SELVA_AUTH_PROVIDER=header` (see [Prerequisites](../deployment/prerequisites.md) and the [CLI guide](../CLI.md)), and a reverse proxy in front of it (see [Reverse proxy](../deployment/reverse-proxy.md)). This page's walkthrough assumes Caddy + oauth2-proxy — one concrete recipe among several; any proxy that can do `forward_auth` and header injection works the same way in principle.

---

## Entra SSO via oauth2-proxy + Caddy

```
Browser ──HTTPS──> Caddy ──forward_auth──> oauth2-proxy ──OIDC──> Entra
                     │
                     └──reverse_proxy──> Selva (127.0.0.1:3000)
                        with SELVA-* identity headers injected
```

Real domain with A record pointing at the host, port 443 open. Replace `[your-domain]` and `admin@corp.com` throughout.

### Part 1 — Entra app registration

1. Entra admin center → **App registrations → New registration** (single tenant).
2. Copy the **Application (client) ID** and **Directory (tenant) ID** from Overview.
3. **Certificates & secrets → New client secret** — copy the Value immediately (shown once).
4. **Authentication → Add platform → Web**. Add redirect URI exactly:
   ```
   https://[your-domain]/oauth2/callback
   ```
   Must be Web platform (not SPA), exact match, no trailing slash.
5. **API permissions**: default `User.Read` (Graph) is sufficient.

You now have: tenant ID, client ID, secret value.

### Part 2 — Install oauth2-proxy

```bash
cd /tmp
curl -fsSL -o oauth2-proxy.tar.gz \
  https://github.com/oauth2-proxy/oauth2-proxy/releases/download/v7.6.0/oauth2-proxy-v7.6.0.linux-amd64.tar.gz
tar -xzf oauth2-proxy.tar.gz
sudo mv oauth2-proxy-*/oauth2-proxy /usr/local/bin/
```

> On ARM (`uname -m` → `aarch64`), swap `linux-amd64` for `linux-arm64`.

Generate a cookie secret:

```bash
python3 -c 'import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

### Part 3 — oauth2-proxy config

```bash
sudo nano /etc/oauth2-proxy.cfg
```

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

Gotchas: `cookie_domains` is plural (a list); `<TENANT_ID>` goes in the middle of the issuer URL; `set_xauthrequest = true` makes oauth2-proxy emit `X-Auth-Request-*` headers; `redirect_url` must exactly match the Entra registration.

```bash
sudo chmod 600 /etc/oauth2-proxy.cfg
sudo oauth2-proxy --config=/etc/oauth2-proxy.cfg   # test — should sit listening, not exit
```

### Part 4 — oauth2-proxy as a service

```bash
sudo nano /etc/systemd/system/oauth2-proxy.service
```

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
sudo systemctl status oauth2-proxy   # expect: active (running)
```

> If `www-data` can't read the config: `sudo chown www-data /etc/oauth2-proxy.cfg` or change `User=`.

### Part 5 — Caddyfile

```bash
sudo nano /etc/caddy/Caddyfile
```

```caddyfile
[your-domain] {
    handle /oauth2/* {
        reverse_proxy 127.0.0.1:4180 {
            header_up X-Real-IP {remote_host}
        }
    }

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

        request_header -SELVA-UserPrincipalName
        request_header -SELVA-Email
        request_header -SELVA-DisplayName

        request_header SELVA-UserPrincipalName {http.request.header.X-Auth-Request-Preferred-Username}
        request_header SELVA-Email             {http.request.header.X-Auth-Request-Email}
        request_header SELVA-DisplayName        {http.request.header.X-Auth-Request-User}

        reverse_proxy 127.0.0.1:3000
    }
}
```

The `request_header -SELVA-*` lines strip inbound copies first — **essential** to prevent header spoofing. The `handle_response @bad` block redirects 401s to the Entra login page (without it you get a bare unauthorized response). Note: use `header Location ...` + `respond 302`, not `redirect` — the latter is not valid inside `handle_response`.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Part 6 — Selva env

In `~/selva/.env`:

```bash
SELVA_AUTH_PROVIDER=header
HOST=127.0.0.1
ORIGIN=https://[your-domain]
BOOTSTRAP_INSTANCE_ADMIN_EMAIL=admin@corp.com
```

`HOST=127.0.0.1` is non-negotiable. Port 3000 must not be open in the firewall.

```bash
cd ~/selva
npm run doctor   # also prints resolved header names — diff vs the Caddyfile
npm run restart
```

### Part 7 — Test the round-trip

```bash
sudo journalctl -u oauth2-proxy -f   # in one window
cd ~/selva && npm run logs            # in another
```

Open `https://[your-domain]`. Expected flow: Caddy gets 401 → redirects to Microsoft login → you authenticate → `/oauth2/callback` → Caddy injects `SELVA-*` headers → Selva loads → bootstrap admin auto-allowlisted.

Verify bootstrap ran:

```bash
ls ~/selva/.selva-data/   # expect header-allowlist.json and user-data.json
```

### Troubleshooting

| Symptom                               | Cause                                     | Fix                                                                |
| ------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `invalid keys: cookie_domain`         | Wrong key name                            | Use `cookie_domains = ["..."]` (plural, list)                      |
| Browser shows plain "unauthorized"    | 401 passed straight back                  | Add `handle_response @bad` redirect block                          |
| `unrecognized directive: redirect`    | `redirect` not valid in `handle_response` | Use `header Location ...` + `respond 302`                          |
| **AADSTS50011** redirect URI mismatch | `redirect_url` ≠ Entra registration       | Make them identical; restart oauth2-proxy                          |
| Bounced after login                   | Bootstrap email ≠ token email             | Compare oauth2-proxy log email to `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` |
| `oauth2-proxy.service` failed         | `www-data` can't read config              | `chown www-data /etc/oauth2-proxy.cfg`                             |

### Day-2

- **Restrict who can log in:** replace `email_domains = ["*"]` with `authenticated_emails_file = "/etc/oauth2-proxy-emails.txt"` (one email per line), or use `allowed_groups` with Entra groups claims.
- **Add users:** after the first admin exists, new users must be pre-allowlisted in **Admin → Users → New user**.
- **Rotate Entra secret:** make a new secret in Entra, update `client_secret` in `/etc/oauth2-proxy.cfg`, restart oauth2-proxy.

## Next

- [Providers overview](../providers.md)
- [Get Started](../getting-started/overview.md)
