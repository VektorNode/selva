---
title: Choosing a provider
order: 0
published: true
description: 'Bring your own backend: auth, data, and storage are pluggable interfaces you pick at deploy time.'
---

# Providers

Auth, data, and storage are **providers**: backends you pick at deploy time by config. The same Selva runs on files on disk, on Supabase, or behind corporate SSO.

Where identity data lives depends on the provider: `local` keeps emails and password hashes on your disk, `supabase` keeps credentials in Supabase Auth, and `header-auth` stores each user's UPN, email and display name in `header-allowlist.json`. The operator is the data controller in every case: see [data privacy](../concepts/data-privacy.md).

## Three roles

- **Auth** (`IAuthProvider`): tokens, users, sessions. The identity it produces drives everything else.
- **Data** (`IDataProvider`): the stores for orgs, projects, definitions and their versions, share links, invites, compute servers, user profiles, platform permissions, platform project grants and API tokens, plus optional audit and event hooks.
- **Storage** (`IStorageProvider`): blobs for definition files and assets.

The interfaces live in [`@selvajs/platform`](https://www.npmjs.com/package/@selvajs/platform), whose README is the contract.

## What ships

| Provider                                | Backend                               | Best for                                  |
| --------------------------------------- | ------------------------------------- | ----------------------------------------- |
| [`local`](./local.md)                   | Files (JSON) + HMAC sessions          | Eval, single-instance                     |
| [`supabase`](./supabase.md)             | Supabase Auth + Postgres + Storage    | Multi-instance, several tenants           |
| [`header-auth`](./header-auth-entra.md) | Trusts reverse-proxy identity headers | Existing SSO (Caddy, oauth2-proxy, Entra) |

Set `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` (default `local`) and restart. `header` is auth-only. For your own, see [Writing a provider](./writing-a-provider.md).

## Mixing providers

The three slots are chosen independently, but only some combinations are documented: all `local`, all `supabase`, and `header` auth with `local` data and storage. Check any other mix before relying on it.

Supabase data scopes every query by a session token issued by the Supabase auth provider; API-token requests get one through its `delegatedSession`. Under another auth provider no token is sent, so queries run as the anon role, which row-level security may deny. `header-auth` has no `delegatedSession`.

## Next

- [Local](./local.md) · [Supabase](./supabase.md) · [Header-auth & Entra](./header-auth-entra.md) · [Writing a provider](./writing-a-provider.md)
- [Architecture](../../architecture.md)
- [Permissions & Organizations](../concepts/permissions.md)
