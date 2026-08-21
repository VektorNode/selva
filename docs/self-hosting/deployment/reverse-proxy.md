---
title: Reverse Proxy
order: 2
published: true
description: 'Why Selva needs a reverse proxy in front of it, and a minimal Caddy example.'
---

# Reverse proxy

Selva must be unreachable except through a reverse proxy: bind it to `127.0.0.1` only, never a public interface, and don't open its port (default 3000) in any firewall. The proxy is the security boundary: it terminates TLS and, if you add SSO later, is what strips and re-injects the `SELVA-*` identity headers (see [Header-auth & Entra](../providers/header-auth-entra.md)).

Any reverse proxy that can do `reverse_proxy` and, later, `forward_auth` works: Caddy, nginx, Traefik, a platform-managed proxy. The example below uses Caddy for its automatic HTTPS; treat it as illustrative.

Assumes Selva is already scaffolded and running per the [CLI guide](../get-started/cli.md).

## Minimal Caddy example

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
selva.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```

Open port 443 (and 80, for ACME + redirect) in your host's firewall; consult its docs, since this varies per provider. Caddy issues and renews the TLS cert automatically. Update `.env`: `ORIGIN=https://selva.yourdomain.com`, and remove `ALLOW_INSECURE_COOKIES=true` if it was set for HTTP-only testing. Then `npm run restart`.

No domain yet? Swap the site block for `:80 { reverse_proxy 127.0.0.1:3000 }`. Cookies will need `ALLOW_INSECURE_COOKIES=true` until HTTPS is live (see [CLI guide](../get-started/cli.md)).

For a hardened config (security headers, per-route caching, access logging), start from [Caddyfile.example](./Caddyfile.example).

## Tell Selva the real client IP

Set these two in `.env` once the proxy is in front of the app:

```bash
ADDRESS_HEADER=X-Forwarded-For
XFF_DEPTH=1
```

`XFF_DEPTH` is how many proxies you run, counted from the outside in — `1` for the Caddy setup above, `2` if a CDN or load balancer sits in front of Caddy. Count wrong and Selva reads the wrong hop.

Without these, `getClientAddress()` returns the socket peer, which is `127.0.0.1` for every request that comes through the proxy. Login rate limiting is keyed on that address, so the entire instance shares one bucket: five failed logins from anywhere lock out every user for 15 minutes, and only a successful login clears the bucket — which nobody can now reach. The app logs a warning the first time it sees this, but the setting is what fixes it.

**These two settings are safe only because the app is bound to `127.0.0.1`.** `X-Forwarded-For` is a client-supplied header. If Selva is reachable directly — a public bind, an open firewall port, a container published to `0.0.0.0` — anyone can spoof it and pick their own rate-limit bucket. Bind to loopback first, then set these.

If your proxy caps request bodies, keep that cap at or above the app's `BODY_SIZE_LIMIT` (default 210M). A lower proxy cap rejects large `file` widget uploads before Selva sees them. The same goes for read timeouts and `COMPUTE_SOLVE_DEADLINE_MS`: a long solve 502s at the proxy regardless of what Selva allows.

## Adding SSO

Pairing Selva with `@selvajs/header-auth-provider` needs the proxy to authenticate the request, then strip any inbound `SELVA-*` headers and set trusted ones before forwarding. Order matters: skipping the strip lets a client spoof identity. Runbook: [Header-auth & Entra](../providers/header-auth-entra.md).

## Debugging

### App running but 502 through the proxy

```bash
npm run logs   # look for ERR_MODULE_NOT_FOUND
sudo ss -tlnp | grep -E ':80|:443|:3000'  # expect the proxy on :80/:443, node on :3000
```

If `:3000` is missing, the app isn't listening; check `npx pm2 list`.

### Caddyfile change didn't take effect

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`validate` catches syntax errors before they silently no-op a reload.
