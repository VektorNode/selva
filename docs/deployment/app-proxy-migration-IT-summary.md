# Selva web app — request to change how it is published (plain-language summary)

**For:** IT / network / Azure administration
**Concerns:** the internal web application at `https://selva.herding.de`
**Technical companion:** [app-proxy-migration.md](./app-proxy-migration.md)

---

## What the application does

Selva is an internal web application. Engineers open it in a browser, adjust
parameters, and the app calculates and displays 3D models. Each calculation
sends the browser a large result — typically **10–20 MB**, sometimes more.

## The problem we measured

The app is currently published through **Microsoft Entra Application Proxy**.
That service relays all traffic through Microsoft's cloud before it reaches the
user.

Application Proxy is designed for ordinary intranet pages (small amounts of
data). For large transfers it has a hard speed limit per download of roughly
**0.8 MB per second (~6 Mbit/s)** — regardless of how fast our server and the
user's connection are. We measured this repeatedly on 2026-07-06:

| What the user waits for                                | Time today        |
| ------------------------------------------------------ | ----------------- |
| One typical model calculation, end to end              | **20–40 seconds** |
| …of which: actual calculation                          | 6–8 seconds       |
| …of which: **data crawling through Application Proxy** | **12–25 seconds** |

We have already added data compression inside the app, which halved the
transfer time. The remaining delay cannot be fixed in software — it is the
per-connection limit of Application Proxy itself. Both our server and our
users have connections that are 20–100× faster than what the proxy lets
through.

## What we propose

Publish the app directly from its server instead of through Application Proxy —
**without giving up Microsoft sign-in**. Users would still log in with exactly
the same Microsoft work account and see the same Microsoft login page. The
login check simply happens on our server (using a standard Microsoft-supported
method called OpenID Connect) instead of inside Microsoft's relay.

Expected result: the 12–25 second transfer drops to **1–2 seconds**.

## What we need from IT (four items)

1. **Firewall:** allow incoming HTTPS (TCP port 443) to the server that hosts
   Selva. This is the only port; nothing else is opened.
2. **DNS:** point `selva.herding.de` at that server's IP address (today it
   points at Microsoft's proxy address, `…msappproxy.net`).
3. **Azure (Entra ID):** one new "app registration" so the server can verify
   Microsoft logins — the same kind of object as the existing Application Proxy
   entry, created in a few minutes in the Azure portal. We will provide the
   exact settings (redirect address etc.).
4. **Later, after a safe transition period:** retire the existing Application
   Proxy entry for Selva.

## Security — what stays the same, what changes

- **Every user still signs in with their Microsoft work account.** Access can
  stay restricted to the same Entra user group as today.
- **Traffic stays encrypted (HTTPS)** with automatically renewed certificates.
- The application itself is **never directly reachable**: on the server it only
  listens on localhost, behind our reverse proxy which enforces the Microsoft
  login on every request. We have a written checklist to verify this after
  deployment and are happy to walk through it together.
- What changes: instead of Microsoft's cloud being the front door, our server
  is. That means the server must be reachable on port 443 — the standard
  posture for any self-hosted HTTPS service.

## Risk and rollback

The change is reversible in one step: pointing the DNS record back at the
Application Proxy address restores today's setup immediately. We would keep the
Application Proxy configuration untouched during a one-week transition period
for exactly this purpose.

## What we are asking for right now

A short meeting or a reply on two questions:

1. Is opening inbound port 443 to this server acceptable? If yes, under what
   conditions (IP allow-listing to office/VPN ranges is fine for us if
   preferred)?
2. Who can create the Entra app registration and adjust the DNS record?

If inbound 443 is not possible under company policy, we will stay on
Application Proxy and limit ourselves to data-size optimizations — but user
waiting times will remain in the 15–30 second range by design of that service.
