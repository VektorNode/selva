---
title: Reverse Proxy
order: 2
published: true
description: 'Why Selva needs a reverse proxy in front of it, and a minimal Caddy example.'
---

# Reverse proxy

Bind Selva to `127.0.0.1` and keep port 3000 closed. `HOST` defaults to `0.0.0.0`. The scaffold sets `127.0.0.1` for header auth and whenever you give an origin; if you added the proxy later, set `HOST=127.0.0.1` yourself. `selva setup-proxy` and `selva doctor` warn when it is not set. The proxy terminates TLS and, with SSO, strips and sets the `SELVA-*` identity headers ([Header-auth & Entra](../providers/header-auth-entra.md)). Any proxy works; the example uses Caddy.

## Minimal Caddy example

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
selva.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```

Open ports 443 and 80 in your firewall. In `.env`, set `ORIGIN=https://selva.yourdomain.com`, remove `ALLOW_INSECURE_COOKIES=true` if set, then `npm run restart`. No domain yet: use `:80` as the site address (plain HTTP) and set `ORIGIN=http://…`, which drops the `Secure` cookie flag so login works over HTTP.

For gzip, the body cap and access logs, start from [Caddyfile.example](./Caddyfile.example). The app sets its own security headers.

## Tell Selva the real client IP

```bash
ADDRESS_HEADER=X-Forwarded-For
XFF_DEPTH=1
```

`XFF_DEPTH` is the number of proxies **you** run in front of Selva. The adapter counts `X-Forwarded-For` entries from the right; anything a client prepends sits further left and is ignored.

| Chain in front of Selva | `XFF_DEPTH` |
| ----------------------- | ----------- |
| Caddy / nginx           | `1`         |
| Cloudflare → Caddy      | `2`         |
| CDN → cloud LB → Caddy  | `3`         |

Caddy replaces an incoming `X-Forwarded-For` with the connecting address unless that address is in `trusted_proxies`. Behind a CDN or load balancer, the last two rows therefore see one entry, and every request that reads the client address throws `XFF_DEPTH is 2, but only found 1 addresses`. Trust the proxy that connects to Caddy:

```caddyfile
{
	servers {
		trusted_proxies static private_ranges
	}
}
```

`private_ranges` covers a load balancer inside your network. Otherwise list the ranges of the proxy that connects to Caddy.

Unsure? Stop Selva and print what arrives:

```bash
npm run stop
node -e 'require("http").createServer((q,s)=>{console.log(q.headers["x-forwarded-for"]);s.end("ok")}).listen(3000)'
```

Load the site from a phone on mobile data (the LAN or server-side `curl` skip hops). The number of comma-separated entries is `XFF_DEPTH`, and the leftmost should be the phone's IP. Then `Ctrl-C` and `npm start`.

- Leftmost isn't the phone: a hop overwrites the header (Caddy does, unless the hop is in `trusted_proxies`). On Cloudflare, use `ADDRESS_HEADER=CF-Connecting-IP` and no `XFF_DEPTH`.
- Nothing prints: the proxy doesn't set it. nginx needs `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`.

Without this, every request looks like `127.0.0.1`. Login rate limiting is per IP, so five failed logins from anyone lock out all users for 15 minutes.

**Safe only while Selva is bound to loopback.** If it is reachable directly, anyone can spoof `X-Forwarded-For` and pick their own rate-limit bucket.

Set the proxy's body cap at or above `BODY_SIZE_LIMIT` (256M) and its read timeout above `COMPUTE_SOLVE_DEADLINE_MS`, or large uploads and long solves fail at the proxy.

## Debugging

502 through the proxy:

```bash
npm run logs   # look for ERR_MODULE_NOT_FOUND
sudo ss -tlnp | grep -E ':80|:443|:3000'  # proxy on :80/:443, node on :3000
```

If `:3000` is missing, check `npx pm2 list`. If a Caddyfile change did nothing, run `sudo caddy validate --config /etc/caddy/Caddyfile` before `systemctl reload caddy`.
