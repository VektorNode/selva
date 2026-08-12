---
title: Supabase provider
order: 2
published: false
description: 'Auth, Postgres, and Storage on Supabase, with identity living in the provider.'
---

# Supabase provider

`@selvajs/supabase-provider`: Auth + Postgres + Storage in one. Reach for it in production, and for deployments serving several tenants: the database itself enforces who can see which rows, so one tenant's query cannot return another's data even if the app asks for it. Postgres calls this row-level security, or RLS.

## When to use it

- You run more than one app instance, or you need a real database.
- Several tenants share the database and must not see each other's rows.
- You already run Supabase (hosted or self-hosted).

## Setup at a glance

1. Provision Supabase, hosted (supabase.com) or local (`npx supabase start`).
2. Apply the migrations shipped with the package.
3. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
4. Set `SELVA_AUTH_PROVIDER=supabase` (and the data/storage vars) and restart.

The same code runs against a local Docker stack or a hosted project. Only the URL and keys change.

Full setup, env vars, migrations, and RLS notes: [supabase-provider README](https://www.npmjs.com/package/@selvajs/supabase-provider).

## Next

- [Providers overview](./overview.md)
- [Get Started](../get-started/overview.md)
