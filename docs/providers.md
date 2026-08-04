---
title: Providers
group: Concepts
order: 3
published: true
description: 'Bring your own backend: auth, data, and storage are pluggable interfaces you pick at deploy time.'
---

# Providers: bring your own backend

Selva doesn't own a database, an auth service, or a file store. Those are **providers**, backends you pick at deploy time. The app is written against interfaces, so the same Selva runs on files on disk, on Supabase, or behind corporate SSO, by config rather than by forking.

## Why

A parametric tool gets deployed everywhere: a solo consultant's box, a multi-tenant SaaS, an enterprise behind Entra ID. Baking in one backend forces everyone into one shape. Selva defines the _contract_ a backend must satisfy and lets you supply the implementation.

It also lets you choose where credentials live. Point Selva at Supabase or corporate SSO and identity stays there — Selva keeps session tokens and authorization data. Run the local provider and Selva _is_ the auth provider, storing emails and password hashes itself. Either way you remain the data controller: Selva also persists display names, invite emails, audit-event payloads, and solve telemetry. See [CLAUDE.md](../CLAUDE.md#data-privacy--compliance) for the full inventory.

## Three roles

You can mix implementations (e.g. Supabase for auth + data, files elsewhere).

| Role        | Interface          | Owns                                                                                                                  |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Auth**    | `IAuthProvider`    | Tokens, users, sessions. The identity it produces drives everything else.                                             |
| **Data**    | `IDataProvider`    | Metadata: orgs, projects, definitions + version history, share links, invites, compute config, profiles, permissions. |
| **Storage** | `IStorageProvider` | Blob storage for definition files and assets.                                                                         |

These are pure TypeScript interfaces in [`@selvajs/platform`](https://www.npmjs.com/package/@selvajs/platform). Each adapter lives in its own package.

## What ships

| Provider                                        | Backend                               | Best for                                  |
| ----------------------------------------------- | ------------------------------------- | ----------------------------------------- |
| [`local`](providers/local.md)                   | Files (JSON) + HMAC sessions          | Eval, single-instance                     |
| [`supabase`](providers/supabase.md)             | Supabase Auth + Postgres + Storage    | Multi-instance, multi-tenant, RLS         |
| [`header-auth`](providers/header-auth-entra.md) | Trusts reverse-proxy identity headers | Existing SSO (Caddy, oauth2-proxy, Entra) |

Select with `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` and restart. Reference: the `.env.example` shipped in your scaffolded deployment.

## The scoping rule

Every request carries a `RequestContext` (the caller's identity + scope). The rule that makes multi-tenancy safe: **the query is the security boundary.** Providers filter every read and write by it. An unauthorized caller gets empty results or an error, never someone else's data.

## Writing your own

For an in-house identity service, a different DB, or an S3-compatible store, see [Writing a provider](providers/writing-a-provider.md).

## Per-backend setup

- [Local](providers/local.md): filesystem, the default.
- [Supabase](providers/supabase.md): Postgres + Auth + Storage.
- [Header-auth & Entra](providers/header-auth-entra.md): SSO behind a reverse proxy.
- [Writing a provider](providers/writing-a-provider.md): roll your own.

## Next

- [Architecture](architecture.md): where providers sit.
- [Permissions & Organizations](permissions.md): the authorization model providers store.
- [Get Started](getting-started/overview.md): deploy with a provider.
