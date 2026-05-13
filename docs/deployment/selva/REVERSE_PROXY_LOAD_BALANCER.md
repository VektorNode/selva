# Reverse Proxy with Caddy

Caddy forwards traffic from port 80/443 to your Selva app on `localhost:3000` and handles SSL automatically.

---

## Install Caddy (Ubuntu/Debian)

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install caddy
```

Or using `setup-caddy.sh` (if you ran `setup.sh`):

```bash
bash setup-caddy.sh                           # HTTP on port 80
bash setup-caddy.sh --domain app.example.com  # HTTPS via Let's Encrypt
```

---

## Configure Caddyfile

Edit `/etc/caddy/Caddyfile`:

**HTTP (IP address only):**

```caddy
:80 {
    reverse_proxy localhost:3000 {
        header_up X-Forwarded-For {http.request.remote.host}
        header_up X-Forwarded-Proto {http.request.proto}
        header_up X-Forwarded-Host {http.request.host}
    }
}
```

**HTTPS (domain — Caddy handles SSL automatically):**

```caddy
example.com {
    reverse_proxy localhost:3000 {
        header_up X-Forwarded-For {http.request.remote.host}
        header_up X-Forwarded-Proto {http.request.proto}
        header_up X-Forwarded-Host {http.request.host}
    }
}
```

Reload after changes:

```bash
sudo systemctl reload caddy
# or
sudo caddy reload --config /etc/caddy/Caddyfile
```

---

## Firewall (Google Cloud example)

Allow TCP ports 80 and 443 inbound, then add tags `http-server` and `https-server` to your VM instance.

---

## Troubleshooting

**Cookies not set / admin login fails:**

The app sets `Secure` cookies in production, which requires HTTPS. For HTTP-only deployments (dev/testing), set `ALLOW_INSECURE_COOKIES=true` in `packages/selva/.env` and restart:

```bash
pm2 restart selva-compute --update-env
```

**Double slashes in requests (`//admin`, `//favicon.svg`):**

`ORIGIN` in `packages/selva/.env` has a trailing slash. Remove it:

```bash
ORIGIN=http://34.52.176.223    # ✅ correct
ORIGIN=http://34.52.176.223/   # ❌ wrong
```

Then:

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
pm2 restart selva-compute
```

**Connection refused (`reverse_proxy localhost:3000` fails):**

```bash
pm2 status  # verify selva-compute is online
```

**Port 80/443 already in use:**

```bash
sudo lsof -i :80
sudo lsof -i :443
```
