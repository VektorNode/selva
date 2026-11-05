---
title: Local provider
order: 1
published: true
description: 'The zero-dependency filesystem provider: JSON on disk, HMAC sessions, WebP transcoding.'
---

# Local provider

`@selvajs/local-provider` is the default for all three slots: JSON files and HMAC sessions, all under one directory. No database, no external services.

Selva is the auth provider here, so `auth-users.json` holds emails and PBKDF2 password hashes on your own disk. See [data privacy](../concepts/data-privacy.md).

## When to pick it

Use local for development, evaluation, or one instance on one VM. Use [Supabase](./supabase.md) for several instances, OAuth sign-in, or database-enforced access rules.

## Setup

Set:

- `SELVA_HMAC_KEY`: signs session cookies, hashes share-link and invite tokens.
- `SELVA_AT_REST_KEY`: encrypts the stored Rhino.Compute API key.
- `DATA_PATH`: a writable directory for users, orgs/projects/definitions JSON, and uploaded `.gh` files. Required; the code has no default (the CLI scaffolds `./.selva-data`). Use an absolute path in production.

Keep both keys stable across restarts: changing the HMAC key signs everyone out, and changing the at-rest key leaves the stored compute key undecryptable. Formats and rotation: [Secrets](../deployment/security-and-limits.md#secrets). A 32-byte hex key satisfies both:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create the first admin through the in-app setup page on first boot. Register the Rhino.Compute URL and API key at `/admin/compute`.

## Backups

```bash
tar -czf backup.tar.gz $DATA_PATH
```

Stop the app first so the archive can't straddle two files. Restore is the reverse.

On-disk layout: [local-provider README](https://github.com/VektorNode/selva/blob/main/packages/providers/local/README.md).

## Next

- [Providers overview](./overview.md)
- [Get Started](../get-started/overview.md)
