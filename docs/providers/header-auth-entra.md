---
title: Header-auth & Entra
group: Providers
order: 3
published: true
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

Full setup, header names, proxy examples, and the self-test: [header-auth-provider README](https://github.com/VektorNode/selva/tree/main/packages/providers/header-auth).

## Next

- [Entra SSO walkthrough (oauth2-proxy + Caddy)](../deployment/Entra.md) — the concrete end-to-end runbook
- [Providers overview](../providers.md)
- [Get Started](../getting-started/overview.md)
