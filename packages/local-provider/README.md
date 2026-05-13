# @selvajs/local-provider

Filesystem + JSON + HMAC implementation of the `@selvajs/platform` interfaces.

The default provider for development and small single-instance deployments. All state — users, orgs, projects, definitions, compute config, uploaded `.gh` files — lives under one directory on disk. No database, no external services.

For production-scale or multi-instance deployments, use [`@selvajs/supabase-provider`](../supabase-provider/README.md) instead.

For testing multi-org tenancy on this provider, see [docs/MultiOrg-LocalDev.md](../../docs/MultiOrg-LocalDev.md).

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

All env vars are documented in [`packages/selva/.env.example`](../compute-app/.env.example) — copy that file to `.env` and edit it. The local provider reads `DATA_PATH`, `SELVA_HMAC_KEY` (signs sessions + tokens), and `SELVA_AT_REST_KEY` (encrypts the Rhino.Compute API key on disk) from there.

The first admin user is created through the in-app setup page on first boot — there is no env-var fallback login.

Rhino.Compute server URL + API key are configured in `/admin/compute` and persisted to `compute.config.json` — not env vars.

---

## On-disk layout

```
$DATA_PATH/
├── users.json                    # users + hashed passwords + platform permissions
├── local-org.json                # organizations, projects, and their memberships
├── definitions-config.json       # definition metadata + version history
├── share-links.json              # per-definition share tokens (HMAC-hashed)
├── invites.json                  # pending invite tokens
├── compute.config.json           # registered Rhino.Compute servers
└── definitions/                  # uploaded .gh / .ghx + cover images
    └── <definition-guid>/
        ├── versions/v{n}.{ext}
        └── cover.webp
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
import { defineConfig } from '@selvajs/platform';
import * as local from '@selvajs/local-provider';

export default defineConfig((env) => ({
	tenancy: 'single' as const,
	flags: {
		ALLOW_CROSS_ORG_PUBLIC: false,
		ALLOW_ORG_COMPUTE_OVERRIDE: false,
		ALLOW_ORG_CREATION: false
	},
	auth: local.LocalAuthProvider.fromEnv(env),
	data: local.LocalDataProvider.fromEnv(env),
	storage: local.LocalStorageProvider.fromEnv(env)
}));
```

`LocalDataProvider` internally wires every store — orgs, projects, definitions, share-links, invites, compute server, user profile, platform permissions.

To switch to Supabase, see [`@selvajs/supabase-provider`](../supabase-provider/README.md#wiring-into-selvaconfigts).

---

## Architecture notes

### Auth

`LocalAuthProvider` issues HMAC-signed session tokens (no JWT library; see [`auth/`](src/auth/)). Tokens carry `{ userId, expiresAt }` and are verified on every request.

Users live in `users.json` with `PBKDF2-SHA256` password hashes and platform permissions. The first admin is bootstrapped through the in-app setup page on a fresh install.

### Data

Each store (`LocalOrgStore`, `LocalProjectStore`, `LocalDefinitionStore`, `LocalInviteStore`, `LocalComputeServerStore`) reads its JSON file fully into memory on each call, mutates, and writes back. Fine at config-scale; not for high-churn data.

Access control is enforced **in-process** by inspecting `RequestContext.adapterContext` — there's no RLS layer to lean on. Tests for these checks live alongside each store.

### Storage

`LocalStorageProvider` writes blobs under `$DATA_PATH/<path>` (e.g. `$DATA_PATH/definitions/<guid>/versions/v1.gh`) — the caller's storage path is appended directly to the data root, with `..` rejected. `getPublicUrl` returns `/api/files/<path>`, which the compute-app proxies after an auth check. Image uploads pass through the shared `transcodeImageIfNeeded` helper from `@selvajs/platform/storage` — same WebP output as Supabase.

### Shared helpers

`src/fsJson.ts` centralizes the read/atomic-write pattern every store uses. See [src/README.md](src/README.md) for details on the helper API.
