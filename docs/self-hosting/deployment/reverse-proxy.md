---
title: Reverse Proxy
order: 2
published: false
description: 'Why Selva needs a reverse proxy in front of it, and a minimal Caddy example.'
---

# Reverse proxy

Selva must be unreachable except through a reverse proxy: bind it to `127.0.0.1` only, never a public interface, and don't open its port (default 3000) in any firewall. The proxy is the security boundary: it terminates TLS and, if you add SSO later, is what strips and re-injects the `SELVA-*` identity headers (see [Header-auth & Entra](../providers/header-auth-entra.md)).

Any reverse proxy that can do a simple `reverse_proxy` and, later, `forward_auth` works: Caddy, nginx, Traefik, a platform-managed proxy. The example below uses Caddy for its automatic HTTPS and simple config; treat it as illustrative, not a requirement.

Assumes Selva is already scaffolded and running per the [CLI guide](../get-started/cli.md).

---

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

## Adding SSO

Pairing Selva with `@selvajs/header-auth-provider` needs the proxy to authenticate the request, then strip any inbound `SELVA-*` headers and set trusted ones before forwarding. Order matters, since skipping the strip lets a client spoof identity. Provider-specific runbooks: [Header-auth & Entra](../providers/header-auth-entra.md).

---

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
