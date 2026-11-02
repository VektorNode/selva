---
title: Choosing a provider
order: 0
published: true
description: 'Bring your own backend: auth, data, and storage are pluggable interfaces you pick at deploy time.'
---

# Providers

Auth, data, and storage are **providers**: backends you pick at deploy time by config. The same Selva runs on files on disk, on Supabase, or behind corporate SSO.

Identity stays in Supabase or your SSO. With the local provider, Selva stores emails and password hashes itself. Either way it also stores display names, invite emails, audit events, and solve telemetry, and the operator is the data controller.

## Three roles

| Role        | Interface          | Owns                                                                                                                  |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Auth**    | `IAuthProvider`    | Tokens, users, sessions. The identity it produces drives everything else.                                             |
| **Data**    | `IDataProvider`    | Metadata: orgs, projects, definitions + version history, share links, invites, compute config, profiles, permissions. |
| **Storage** | `IStorageProvider` | Blob storage for definition files and assets.                                                                         |

The interfaces live in [`@selvajs/platform`](https://www.npmjs.com/package/@selvajs/platform). Mix providers freely.

## What ships

| Provider                                | Backend                               | Best for                                  |
| --------------------------------------- | ------------------------------------- | ----------------------------------------- |
| [`local`](./local.md)                   | Files (JSON) + HMAC sessions          | Eval, single-instance                     |
| [`supabase`](./supabase.md)             | Supabase Auth + Postgres + Storage    | Multi-instance, several tenants           |
| [`header-auth`](./header-auth-entra.md) | Trusts reverse-proxy identity headers | Existing SSO (Caddy, oauth2-proxy, Entra) |

Set `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` (default `local`) and restart. `header` is auth-only. For your own, see [Writing a provider](./writing-a-provider.md).

## The scoping rule

**The query is the security boundary:** providers filter every read and write by the request's `RequestContext`, so a caller never sees someone else's data.

## Next

- [Local](./local.md) · [Supabase](./supabase.md) · [Header-auth & Entra](./header-auth-entra.md) · [Writing a provider](./writing-a-provider.md)
- [Architecture](../../architecture.md)
- [Permissions & Organizations](../concepts/permissions.md)
