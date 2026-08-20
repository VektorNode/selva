---
title: Providers
order: 3
published: true
description: 'Bring your own backend: auth, data, and storage are pluggable interfaces you pick at deploy time.'
---

# Providers

Selva doesn't own a database, an auth service, or a file store. Those are **providers** — backends you pick at deploy time. The app is written against interfaces, so the same Selva runs on files on disk, on Supabase, or behind corporate SSO. You switch by config, not by forking.

Where credentials live follows from that choice. Point Selva at Supabase or corporate SSO and identity stays there, with Selva keeping only session tokens and authorization data. Run the local provider and Selva _is_ the auth provider, storing emails and password hashes itself. Either way Selva also stores display names, invite emails, audit-event payloads, and solve telemetry — the deployment operator is the data controller for all of it.

## Three roles

Mix implementations freely — Supabase for auth and data, files elsewhere, for example.

| Role        | Interface          | Owns                                                                                                                  |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Auth**    | `IAuthProvider`    | Tokens, users, sessions. The identity it produces drives everything else.                                             |
| **Data**    | `IDataProvider`    | Metadata: orgs, projects, definitions + version history, share links, invites, compute config, profiles, permissions. |
| **Storage** | `IStorageProvider` | Blob storage for definition files and assets.                                                                         |

These are plain TypeScript interfaces in [`@selvajs/platform`](https://www.npmjs.com/package/@selvajs/platform). Each adapter lives in its own package.

## What ships

| Provider                                | Backend                               | Best for                                  |
| --------------------------------------- | ------------------------------------- | ----------------------------------------- |
| [`local`](./local.md)                   | Files (JSON) + HMAC sessions          | Eval, single-instance                     |
| [`supabase`](./supabase.md)             | Supabase Auth + Postgres + Storage    | Multi-instance, several tenants           |
| [`header-auth`](./header-auth-entra.md) | Trusts reverse-proxy identity headers | Existing SSO (Caddy, oauth2-proxy, Entra) |

Pick one per slot with `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER`, then restart. Each defaults to `local`. Note `header` is auth-only — pair it with `local` or `supabase` for data and storage.

For a provider not shipped in the box, point `SELVA_CONFIG_PATH` at a `.js` file exporting a `defineConfig()` result. See [Writing a provider](./writing-a-provider.md).

## The scoping rule

Every request carries a `RequestContext` — the caller's identity and scope. One rule makes multi-tenancy safe: **the query is the security boundary.** Providers filter every read and write by that context, so an unauthorized caller gets empty results or an error, never someone else's data.

## Next

- [Local](./local.md) · [Supabase](./supabase.md) · [Header-auth & Entra](./header-auth-entra.md) · [Writing a provider](./writing-a-provider.md)
- [Architecture](../../architecture.md): where providers sit.
- [Permissions & Organizations](../concepts/permissions.md): the authorization model providers store.
