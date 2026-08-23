---
title: Local provider
order: 1
published: true
description: 'The zero-dependency filesystem provider: JSON on disk, HMAC sessions, WebP transcoding.'
---

# Local provider

`@selvajs/local-provider`: filesystem + JSON + HMAC sessions, and the default for all three slots. Every piece of state lives under one directory. No database, no external services.

Under this provider Selva **is** the auth provider: `auth-users.json` holds email addresses and PBKDF2 password hashes on the deployment's own disk. No third party holds them, and you are the data controller for them.

## When to pick it

Local, when you're developing or evaluating Selva; running a single-tenant, single-instance deployment (one VM, PM2); want no external dependencies at all; and are happy with file-based backups.

[Supabase](./supabase.md), when you need several app instances behind a load balancer, managed auth (password reset, MFA, OAuth), managed Postgres and storage with backups and per-row access rules enforced by the database, or a counter several processes can raise at once without losing increments.

## Setup

It's the default, so no provider env vars are needed. Set:

- `SELVA_HMAC_KEY`: signs session cookies, hashes share-link and invite tokens.
- `SELVA_AT_REST_KEY`: encrypts the stored Rhino.Compute API key.
- `DATA_PATH`: a writable directory for users, orgs/projects/definitions JSON, and uploaded `.gh` files. Defaults to `.selva-data/` at the repo root; use an absolute path in production.

Both keys must be 32 bytes and stable across restarts:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create the first admin through the in-app setup page on first boot; there is no env-var fallback login. Register the Rhino.Compute server URL and API key at `/admin/compute`; they persist to `compute.config.json`, not env vars.

## Backups

```bash
tar -czf backup.tar.gz $DATA_PATH
```

Restore is the reverse. No schema migrations, no database to bring up. Stop the app first: the JSON files are written atomically, but a `tar` taken mid-request can still straddle two files.

On-disk layout and architecture notes: [local-provider README](https://github.com/VektorNode/selva/blob/main/packages/providers/local/README.md).

## Next

- [Providers overview](./overview.md)
- [Get Started](../get-started/overview.md)
