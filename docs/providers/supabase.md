---
title: Supabase provider
group: Providers
order: 2
published: true
---

# Supabase provider

`@selvajs/supabase-provider`: Auth + Postgres + Storage in one. The production choice for multi-instance, multi-tenant deployments with row-level security.

## When to use it

- More than one app instance, or you need a real database.
- Multi-tenant with RLS isolation.
- You already run Supabase (hosted or self-hosted).

## Setup at a glance

1. Provision Supabase, hosted (supabase.com) or local (`npx supabase start`).
2. Apply the migrations shipped with the package.
3. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
4. Set `SELVA_AUTH_PROVIDER=supabase` (and the data/storage vars) and restart.

Same code runs against a local Docker stack or a hosted project; only the URL and keys change.

Full setup, env vars, migrations, and RLS notes: [supabase-provider README](https://github.com/VektorNode/selva/tree/main/packages/providers/supabase).

## Next

- [Providers overview](../providers.md)
- [Get Started](../getting-started/overview.md)
