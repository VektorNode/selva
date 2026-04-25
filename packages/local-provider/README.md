# selva-local-provider

Filesystem + JSON + HMAC implementation of the `@selva/platform` interfaces.

The default provider for development and small single-instance deployments. All state — users, orgs, projects, definitions, compute config, uploaded `.gh` files — lives under one directory on disk. No database, no external services.

For production-scale or multi-instance deployments, use [`@selva/supabase-provider`](../supabase-provider/README.md) instead.

---

## Table of contents

- [When to use this provider](#when-to-use-this-provider)
- [Environment variables](#environment-variables)
- [On-disk layout](#on-disk-layout)
- [Wiring into `selva.config.ts`](#wiring-into-selvaconfigts)
- [Architecture notes](#architecture-notes)

---

## When to use this provider

Pick local when:

- You're developing or evaluating Selva
- You're running a single-tenant, single-instance deployment (one VM, PM2)
- You want zero external dependencies — no DB, no S3
- You're OK with simple file-based backups (`tar` the data dir)

Pick [Supabase](../supabase-provider/README.md) when:

- You need multiple compute-app instances behind a load balancer
- You want managed auth (password reset, MFA, OAuth)
- You want managed Postgres + storage with backups + RLS
- You need atomic counters across processes

---

## Environment variables

Set these in the compute-app's `.env` (see [`packages/compute-app/.env.example`](../compute-app/.env.example)):

| Variable | Required | Description |
|---|---|---|
| `DATA_PATH` | ✅ | Directory the provider reads/writes. Holds `users.json`, `orgs/`, `projects/`, `definitions/`, `compute.config.json`, and uploaded blobs. Created on first write if missing. |
| `SESSION_SECRET` | ✅ | HMAC secret used to sign session cookies. Must be stable across restarts. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |

The first admin user is created through the in-app setup page on first boot — there is no env-var fallback login.

Rhino.Compute server URL + API key are configured in `/admin/compute` and persisted to `compute.config.json` — not env vars.

---

## On-disk layout

```
$DATA_PATH/
├── users.json                    # all users + hashed passwords + platform permissions
├── compute.config.json           # registered Rhino.Compute servers
├── orgs.json                     # organizations + members
├── projects.json                 # projects + members
├── definitions.json              # definition metadata (filenames, owners, run counts)
├── invites.json                  # pending invite tokens
└── files/                        # uploaded .gh / .ghx + cover images
    └── <project-id>/
        └── <definition-id>.gh
```

All JSON files are written atomically (temp file + rename) so a crash mid-write leaves either the old or new file — never a partial. Image uploads are transcoded to WebP (1200px max, quality 85) via `sharp`.

**Backups:** `tar -czf backup.tar.gz $DATA_PATH`. Restore is the reverse — no schema migrations, no DB to bring up.

**Caveats:**

- Not safe across **processes** — no file locking. One compute-app instance per data dir.
- Read-modify-write on JSON files (`incrementRunCount`, etc.) can lose updates under concurrent solves on the same definition. Acceptable for typical single-user workloads; switch to Supabase if you need exact counts under contention.

---

## Wiring into `selva.config.ts`

This is the default config in [`selva.config.ts`](../../selva.config.ts) at the repo root:

```ts
import { defineConfig } from '@selva/platform/config';
import {
  LocalAuthProvider,
  LocalDataProvider,
  LocalStorageProvider,
  LocalUserProfileProvider
} from 'selva-local-provider';

export default defineConfig((env) => ({
  auth: LocalAuthProvider.fromEnv(env),
  data: LocalDataProvider.fromEnv(env),
  storage: LocalStorageProvider.fromEnv(env),
  userProfile: LocalUserProfileProvider.fromEnv(env)
}));
```

To switch to Supabase, see [`@selva/supabase-provider`](../supabase-provider/README.md#wiring-into-selvaconfigts).

---

## Architecture notes

### Auth

`LocalAuthProvider` issues HMAC-signed session tokens (no JWT library; see [`auth/`](src/auth/)). Tokens carry `{ userId, expiresAt }` and are verified on every request.

Users live in `users.json` with `argon2id` password hashes and platform permissions. The first admin is bootstrapped through the in-app setup page on a fresh install.

### Data

Each store (`LocalOrgStore`, `LocalProjectStore`, `LocalDefinitionStore`, `LocalInviteStore`, `LocalComputeServerStore`) reads its JSON file fully into memory on each call, mutates, and writes back. Fine at config-scale; not for high-churn data.

Access control is enforced **in-process** by inspecting `RequestContext.adapterContext` — there's no RLS layer to lean on. Tests for these checks live alongside each store.

### Storage

`LocalStorageProvider` writes blobs under `$DATA_PATH/files/`. `getPublicUrl` returns `/api/files/<path>`, which the compute-app proxies after an auth check. Image uploads pass through the shared `transcodeImageIfNeeded` helper from `@selva/platform/storage` — same WebP output as Supabase.

### Shared helpers

`src/fsJson.ts` centralizes the read/atomic-write pattern every store uses. See [src/README.md](src/README.md) for details on the helper API.
