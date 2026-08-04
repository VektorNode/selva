---
title: Local provider
group: Providers
order: 1
published: true
description: 'The zero-dependency filesystem provider — JSON on disk, HMAC sessions, WebP transcoding.'
---

# Local provider

`@selvajs/local-provider`: filesystem + JSON + HMAC sessions. The default. All state lives under one directory on disk: no database, no external services.

## When to use it

- Developing or evaluating Selva.
- A small, single-instance deployment.

For multi-instance or multi-tenant, use [Supabase](../providers/supabase.md) instead.

## Setup at a glance

1. It's the default, so no provider env vars are needed.
2. Set `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` (see `.env.example`).
3. Point `DATA_PATH` at a writable directory.

On-disk layout, env vars, and architecture notes: [local-provider README](https://www.npmjs.com/package/@selvajs/local-provider).

## Next

- [Providers overview](../providers.md)
- [Get Started](../getting-started/overview.md)
