# @selvajs/local-provider

Filesystem + JSON + HMAC implementation of the `@selvajs/platform` interfaces — `IAuthProvider`, `IDataProvider`, `IStorageProvider`.

The default for all three provider slots. All state — users, orgs, projects, definitions, compute config, uploaded `.gh` files — lives under one directory on disk. No database, no external services.

For multi-instance or multi-tenant deployments, use [`@selvajs/supabase-provider`](../supabase/README.md).

**Operator setup — env vars, key generation, backups:** [docs/self-hosting/providers/local.md](../../../docs/self-hosting/providers/local.md).

---

## Usage

```ts
import { defineConfig } from '@selvajs/platform';
import {
	LocalAuthProvider,
	LocalDataProvider,
	LocalStorageProvider
} from '@selvajs/local-provider';

export default defineConfig((env) => ({
	auth: LocalAuthProvider.fromEnv(env),
	data: LocalDataProvider.fromEnv(env),
	storage: LocalStorageProvider.fromEnv(env)
}));
```

The Selva app already bundles this wiring — `fromEnv` reads `DATA_PATH`, `SELVA_HMAC_KEY`, and `SELVA_AT_REST_KEY`. `LocalDataProvider.fromEnv` constructs every store: orgs, projects, definitions, share links, invites, compute server, user profile, platform permissions, platform project grants.

---

## On-disk layout

```
$DATA_PATH/
├── auth-users.json               # identity only: users + hashed passwords
├── user-data.json                # per-user app state: permissions, profile, starred defs, recent runs
├── platform-project-grants.json  # platform-level project grants
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

The blob paths come from `definitionPaths` in `@selvajs/platform` — `LocalStorageProvider` appends them to `$DATA_PATH` verbatim.

All JSON files are written atomically (temp file + rename) so a crash mid-write leaves either the old or new file — never a partial.

**Caveats:**

- Not safe across **processes** — no file locking. One selva app instance per data dir.
- Read-modify-write on JSON files (`incrementRunCount`, etc.) can lose updates under concurrent solves on the same definition. Acceptable for typical single-user workloads; switch to Supabase if you need exact counts under contention.

---

## Architecture notes

### Auth

`LocalAuthProvider` ([src/auth/LocalAuthProvider.ts](src/auth/LocalAuthProvider.ts)) issues HMAC-SHA256 session tokens — no JWT library. Tokens carry `{ userId, expiresAt }` and are verified on every request.

Users live in `auth-users.json` ([src/auth/users.ts](src/auth/users.ts)) with PBKDF2-SHA256 password hashes, stored as `pbkdf2:sha256:<iterations>:<salt>:<hash>` (100 000 iterations, 32-byte key, base64url). Platform permissions live separately in `user-data.json`. The first admin is bootstrapped through the in-app setup page on a fresh install — there is no env-var fallback login.

**Under this provider Selva _is_ the auth provider** — email addresses and password hashes sit on the deployment's own disk, with no third party holding them. The operator is the data controller for all of it; see [CLAUDE.md](../../../CLAUDE.md#data-privacy) for the full inventory.

### Data

Each store (`LocalOrgStore`, `LocalProjectStore`, `LocalDefinitionStore`, `LocalInviteStore`, `LocalComputeServerStore`, `LocalShareLinkStore`, `LocalPlatformProjectGrantStore`, `LocalPlatformPermissionStore`, `LocalUserProfileProvider`) reads its JSON file fully into memory on each call, mutates, and writes back. Fine at config-scale; not for high-churn data.

Access control is enforced **in the app process** by inspecting `RequestContext.adapterContext`. There is no database underneath to enforce it a second time, so these checks are the only thing standing between a caller and someone else's data. Tests for them live alongside each store.

### Storage

`LocalStorageProvider` writes blobs under `$DATA_PATH/<path>` — the caller's storage path is appended directly to the data root, with `..` rejected. `getPublicUrl` returns `/api/files/<path>`, which the selva app proxies after an auth check. Image uploads pass through the shared `transcodeImageIfNeeded` helper from `@selvajs/platform/storage` (WebP, 1200px cap, quality 85) — same bytes as Supabase.

### Shared helpers

[src/data/fsJson.ts](src/data/fsJson.ts) centralizes the read/atomic-write pattern every store uses. See [src/README.md](src/README.md) for the helper API.

---

## Conformance tests

The `@selvajs/platform` conformance suites run against this provider in-process — no external services, no setup.

```bash
cd packages/providers/local
pnpm test          # vitest run
pnpm test:watch
```

`src/**/__tests__/*-conformance.test.ts` covers the org, project, definition, invite, share-link, compute-server, event-sink, and platform-project-grant stores, plus auth, permissions, storage, and user-profile. A new store is wired up by pointing its suite at a temp directory.
