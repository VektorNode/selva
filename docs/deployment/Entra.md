# Entra SSO for Selva via oauth2-proxy + Caddy (forward_auth)

A one-to-one runbook for putting a Selva (header-auth) deployment behind
Microsoft Entra login, using **plain Caddy** (no custom build) and
**oauth2-proxy** as the OIDC sidecar.

## How it fits together

```
Browser ──HTTPS──> Caddy ──forward_auth──> oauth2-proxy ──OIDC──> Entra
                     │                          │
                     │   (on 401, Caddy redirects browser to Entra login)
                     │
                     └──reverse_proxy──> Selva (127.0.0.1:3000)
                        with SELVA-* identity headers injected
```

- **Entra** authenticates the user and issues a token with claims. It never sets HTTP headers.
- **oauth2-proxy** runs the OIDC flow, reads the claims, and exposes them as `X-Auth-Request-*` response headers.
- **Caddy** asks oauth2-proxy "is this authenticated?" via `forward_auth`, redirects to login on 401, and on success copies the `X-Auth-Request-*` headers into the `SELVA-*` headers Selva expects.
- **Selva** runs in header-auth mode, bound to localhost, and trusts those headers.

The reverse proxy is the security boundary: Selva must be unreachable except through Caddy, or anyone could spoof the `SELVA-*` headers.

---

## Assumptions

- Ubuntu/Debian VM with a public IP.
- **Plain Caddy already installed** and running as a systemd service.
- A **Selva deployment already scaffolded** (e.g. `~/selva`).
- A **real domain** whose A record points at the VM, and **port 443 open** in the firewall.

Replace `[your-donmain]` and `admin@corp.com` throughout with your own domain and login email.

---

## Part 1 — Entra app registration

1. Entra admin center → **App registrations → New registration**.
   - Name it (e.g. "Selva SSO").
   - Supported account types: **single tenant** ("Accounts in this organizational directory only") unless you need otherwise.
2. From the **Overview** page, copy down:
   - **Application (client) ID**
   - **Directory (tenant) ID**
3. **Certificates & secrets → Client secrets → New client secret**.
   - Set an expiry, click Add, then **immediately copy the Value** (not the Secret ID). It is shown only once — if you leave the page, delete it and make a new one.
4. **Authentication → Add a platform → Web**. Add the redirect URI **exactly**:

   ```
   https://[your-donmain]/oauth2/callback
   ```

   - Must be the **Web** platform (server-side flow), not SPA.
   - Exact match: `https`, host, `/oauth2/callback`, no trailing slash, no `www`. Save.

5. **API permissions**: the default Microsoft Graph `User.Read` is enough (covers `openid`, `email`, `profile`). No admin consent needed for single-tenant sign-in.

You should now have three values: **tenant ID, client ID, secret value**.

---

## Part 2 — Install oauth2-proxy

```bash
cd /tmp
curl -fsSL -o oauth2-proxy.tar.gz \
  https://github.com/oauth2-proxy/oauth2-proxy/releases/download/v7.6.0/oauth2-proxy-v7.6.0.linux-amd64.tar.gz
tar -xzf oauth2-proxy.tar.gz
sudo mv oauth2-proxy-*/oauth2-proxy /usr/local/bin/
oauth2-proxy --version          # expect: oauth2-proxy v7.6.0
```

> On an ARM VM (`uname -m` → `aarch64`), swap `linux-amd64` for `linux-arm64` in the URL.

Generate a cookie secret (exactly 32 bytes — use the command, don't type one by hand):

```bash
python3 -c 'import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

Copy the ~44-character output.

---

## Part 3 — oauth2-proxy config

```bash
sudo nano /etc/oauth2-proxy.cfg
```

Paste, filling in the four placeholders and your domain:

```ini
provider = "oidc"
oidc_issuer_url = "https://login.microsoftonline.com/<TENANT_ID>/v2.0"
client_id = "<CLIENT_ID>"
client_secret = "<SECRET_VALUE>"
cookie_secret = "<COOKIE_SECRET>"

http_address = "127.0.0.1:4180"
reverse_proxy = true
redirect_url = "https://[your-donmain]/oauth2/callback"

oidc_email_claim = "preferred_username"

email_domains = ["*"]
set_xauthrequest = true
skip_provider_button = true

cookie_secure = true
cookie_domains = ["[your-donmain]"]
```

Notes / gotchas (all of these bit us):

- The key is **`cookie_domains`** (plural, a list), not `cookie_domain`.
- `redirect_url` must **exactly** match the URI registered in Entra (Part 1, step 4).
- `<TENANT_ID>` goes in the **middle** of the issuer URL; keep the `/v2.0` suffix.
- `set_xauthrequest = true` is what makes oauth2-proxy emit `X-Auth-Request-*` headers.

Lock the file (it holds the secret):

```bash
sudo chmod 600 /etc/oauth2-proxy.cfg
```

Test the config in the foreground:

```bash
sudo oauth2-proxy --config=/etc/oauth2-proxy.cfg
```

Success = it performs OIDC discovery, prints the client ID and cookie settings, and **sits there listening** (doesn't return the prompt). `Ctrl+C` to stop. Any `invalid keys` error names the offending key — fix and re-run.

---

## Part 4 — Run oauth2-proxy as a service

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
sudo systemctl status oauth2-proxy          # expect: active (running)
```

> If it shows `failed` because `www-data` can't read the config, either
> `sudo chown www-data /etc/oauth2-proxy.cfg` or change `User=` to your own user.

---

## Part 5 — Caddyfile

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

What each part does:

- `handle /oauth2/*` → passes oauth2-proxy's own endpoints (login, callback, sign-out) straight through to it.
- `forward_auth` → asks oauth2-proxy `/oauth2/auth` whether the request is authenticated.
- The `handle_response @bad` block → on a **401**, redirects the browser to `/oauth2/start` to begin the Entra login. Without this you get a bare "unauthorized" page instead of a login redirect.
- The `request_header -SELVA-*` (strip) lines → **delete any inbound copies first** so a browser can't spoof them. Essential.
- The `request_header SELVA-*` (set) lines → map oauth2-proxy's `X-Auth-Request-*` onto the `SELVA-*` names Selva reads.

Validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

> `redirect` is **not** valid inside `handle_response` in current Caddy — use the
> `header Location ...` + `respond 302` form shown above.

---

## Part 6 — Selva env (header-auth mode)

In `~/selva/.env`, the **active** (non-commented) lines must be:

```bash
SELVA_AUTH_PROVIDER=header
HOST=127.0.0.1
ORIGIN=https://[your-domain]
BOOTSTRAP_INSTANCE_ADMIN_EMAIL=admin@corp.com
```

- `HOST=127.0.0.1` is non-negotiable — Selva must be reachable only via Caddy.
- `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` must **exactly match** the email Entra sends in the token (see verification below).
- Port 3000 must **not** be open in the firewall.

```bash
cd ~/selva
npm run doctor      # also prints the resolved header names — diff vs the Caddyfile
npm run restart
```

---

## Part 7 — Test the login round-trip

Pre-flight:

```bash
dig +short [your-domain]      # must equal the VM's external IP
curl -s ifconfig.me; echo
```

Tail the logs (ideally in two windows):

```bash
sudo journalctl -u oauth2-proxy -f
cd ~/selva && npm run logs
```

Then open **https://[your-domain]** and sign in with Entra. Expected flow:

1. Caddy fetches the Let's Encrypt cert on first request (first load can take a few seconds).
2. oauth2-proxy returns 401 → Caddy redirects you to the Microsoft sign-in page.
3. You authenticate → Microsoft redirects to `/oauth2/callback`.
4. oauth2-proxy logs the authenticated email → Caddy injects `SELVA-*` headers → Selva loads.
5. If the bootstrap email matched, the first request auto-allowlists you as admin.

Verify the bootstrap actually wrote data:

```bash
ls ~/selva/.selva-data/        # expect header-allowlist.json and user-data.json
```

---

## Troubleshooting (what actually went wrong for us)

| Symptom                                            | Cause                                         | Fix                                                                                           |
| -------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `invalid keys: cookie_domain`                      | Wrong key name                                | Use `cookie_domains = ["..."]` (plural, list)                                                 |
| Browser shows plain **"unauthorized"**             | forward_auth passes the 401 straight back     | Add the `handle_response @bad` redirect block (Part 5)                                        |
| `unrecognized directive: redirect` on validate     | `redirect` isn't allowed in `handle_response` | Use `header Location ...` + `respond 302`                                                     |
| **AADSTS50011** redirect URI mismatch              | `redirect_url` ≠ the URI registered in Entra  | Make both **identical**, exact match; restart oauth2-proxy after editing config               |
| Reached Microsoft but bounced after login          | Bootstrap email ≠ token email                 | Compare the email in the oauth2-proxy log to `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`; set them equal |
| `oauth2-proxy.service` failed                      | `www-data` can't read config                  | `chown www-data /etc/oauth2-proxy.cfg` or change `User=`                                      |
| Junk requests like `/wp-admin/install.php` in logs | Internet background bots                      | Harmless — oauth2-proxy correctly 401s them. Optionally restrict firewall source ranges       |

---

## Day-2 notes

- **Restrict who can log in:** replace `email_domains = ["*"]` with an
  `authenticated_emails_file = "/etc/oauth2-proxy-emails.txt"` (one email per line),
  or use `allowed_groups` with the Entra `groups` claim added under Token configuration.
- **Add more Selva users:** after the first admin exists, the bootstrap window closes.
  New users must be pre-allowlisted in **Admin → Users → New user** before they can log in.
- **Secret rotation:** when the Entra client secret expires, make a new one, update
  `client_secret` in `/etc/oauth2-proxy.cfg`, and `sudo systemctl restart oauth2-proxy`.
