---
title: Providers
order: 3
published: false
description: 'Bring your own backend: auth, data, and storage are pluggable interfaces you pick at deploy time.'
---

# Providers: bring your own backend

Selva doesn't own a database, an auth service, or a file store. Those are **providers**, backends you pick at deploy time. The app is written against interfaces, so the same Selva runs on files on disk, on Supabase, or behind corporate SSO. You switch by config, not by forking.

## Why

A parametric tool gets deployed everywhere: a solo consultant's box, a multi-tenant SaaS, an enterprise behind Entra ID. Baking in one backend forces all of them into one shape. Selva instead defines the _contract_ a backend has to satisfy and lets you supply the implementation.

You also get to choose where credentials live. Point Selva at Supabase or corporate SSO and identity stays there, while Selva keeps only session tokens and authorization data. Run the local provider and Selva _is_ the auth provider, storing emails and password hashes itself. Either way the deployment is yours and so is responsibility for the personal data in it, because Selva also stores display names, invite emails, audit-event payloads, and solve telemetry.

## Three roles

You can mix implementations: Supabase for auth and data, files elsewhere, for example.

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

Pick one with `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER`, then restart. The `.env.example` shipped in your scaffolded deployment documents each one.

## The scoping rule

Every request carries a `RequestContext`, the caller's identity and scope. One rule makes multi-tenancy safe: **the query is the security boundary.** Providers filter every read and write by that context, so an unauthorized caller gets empty results or an error, never someone else's data.

## Writing your own

To back Selva with an in-house identity service, a different database, or an S3-compatible store, see [Writing a provider](./writing-a-provider.md).

## Per-backend setup

- [Local](./local.md): filesystem, the default.
- [Supabase](./supabase.md): Postgres + Auth + Storage.
- [Header-auth & Entra](./header-auth-entra.md): SSO behind a reverse proxy.
- [Writing a provider](./writing-a-provider.md): roll your own.

## Next

- [Architecture](../../architecture.md): where providers sit.
- [Permissions & Organizations](../concepts/permissions.md): the authorization model providers store.
- [Get Started](../get-started/overview.md): deploy with a provider.
