# Testing the three auth providers locally

No VMs. Two of the three run natively; the third needs a local Caddy.

```bash
pnpm dev:local       # filesystem JSON + password auth
pnpm dev:supabase    # Supabase CLI stack (needs Docker)
pnpm dev:header      # forward-auth — the code path Entra reaches (needs Caddy)
```

Each maps to a vite `--mode`, so vite layers `packages/selva/.env.dev-<provider>`
over the base `.env`. Every provider gets its own `DATA_PATH`, so switching never
leaves one provider reading another's store.

## Entra without Entra

`HeaderAuthProvider` does no crypto and validates no token. It reads three plain
headers — `SELVA-UserPrincipalName`, `SELVA-Email`, `SELVA-DisplayName` — and
trusts them, because in production a locked-down proxy is what sets them.

So there is nothing about Entra to reproduce locally. A Caddy that sets those
three headers exercises byte-for-byte the same code as Entra + oauth2-proxy.
`pnpm dev:header` starts that Caddy on `:8080` and the app on `:5173` — **open
:8080**, not :5173, or you arrive with no identity at all.

The generated `scripts/.dev-caddyfile` keeps production's directive order: strip
inbound `SELVA-*` at site scope, then inject. That ordering is itself a
production footgun (Caddy reorders `request_header` inside a `handle` block), so
the dev config validates it too.

No Caddy installed? The script prints a ready-to-paste curl. That hits the app
directly and works fine — it just skips the proxy-ordering check:

```bash
curl -H "SELVA-UserPrincipalName: admin@dev.local" \
     -H "SELVA-Email: admin@dev.local" \
     -H "SELVA-DisplayName: Ada Admin" \
     http://localhost:5173/
```

## Personas

Identities live in `scripts/dev-personas.json`; pick one with `--persona`:

```bash
node scripts/dev-provider.mjs header --persona member
```

`member` has a UPN that differs from its email (`member@dev.onmicrosoft.com` vs
`member@dev.local`) — the Entra shape where UPN ≠ mail, which exercises the
email-fallback and `rebindUpn` branch in `identifyFromHeaders`. `admin` matches
`BOOTSTRAP_INSTANCE_ADMIN_EMAIL` and becomes instance admin; `outsider` is in
neither, for testing rejection.

Caddy holds one persona for its lifetime — switching means restarting the script.

## Supabase

`pnpm dev:supabase` runs `supabase start` first and waits for it. Studio is on
`:54423`, and magic-link emails land in Inbucket on `:54424` rather than being
sent.

The API port is **54421**, not the 54321 in Supabase's own docs — set in
`packages/providers/supabase/supabase/config.toml`. (`.env.example:210` and the
provider README still say 54321; they're wrong.)

## Keys

The keys in `.env.dev-*` are dev-only throwaways, and the Supabase ones are the
CLI's published deterministic local keys. They are committed on purpose so the
harness works on checkout. Nothing here is a secret, and nothing here should
ever reach a deployment.
