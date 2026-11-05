# Selva Architecture

Internal reference for checking code against intended design. Companion to
[Access Control](./permissions.md), which owns _who can do what_; this document owns _what exists
and how it fits together_.

---

## 1. What Selva is

Selva takes a Grasshopper definition and exposes it as a configurable web application: schema-driven
UI on top, Rhino.Compute solving on the backend. Two runtime modes share one schema:

- **Plugin UI** (`@selvajs/plugin-ui`): the designer's companion, embedded into the Grasshopper
  plugin. Talks to a running Grasshopper over WebSocket, hot-reloads as the schema is edited.
- **Compute app** (`@selvajs/selva`): the deployed product. Standalone, multi-user, solves through
  Rhino.Compute.

[packages/schemas/ui-schema.json](../../packages/schemas/ui-schema.json) (the saved UI schema) and
[wire-schema.json](../../packages/schemas/wire-schema.json) (messages and runtime state) are the source
contract: they generate TypeScript for the web stack and C# for the plugin, so the shapes cannot drift.
After editing either, run `pnpm generate` from the repo root; CI fails on stale output. Outputs and
generator conventions are in [packages/schemas/README.md](../../packages/schemas/README.md).

The two runtimes share no code. They meet in the schema format, the `.gh` / `.ghx` file the designer
uploads, and Selva's HTTP API, which the plugin signs in to and uploads over (`SelvaUploadService`).

---

## 2. Entity model

```
Instance (one Selva deployment)
 ├── User (identity, owned by IAuthProvider)
 │    └── UserProfile (displayName, starredDefinitions, recentRuns)
 │
 ├── PlatformPermission(userId, permission)      ← IPlatformPermissionStore
 │
 ├── Organization                                ← hard tenancy boundary
 │    ├── OrgMember (User × Org): role + permissions[]
 │    ├── Invite (pending email → org + role)
 │    ├── ComputeServerConfig (optional org override)
 │    └── Project
 │         ├── visibility: private | org | public | platform
 │         ├── autoJoinOnUpload: bool   ← container vs commons mode
 │         ├── ProjectMember (User × Project): owner | editor | viewer
 │         └── Definition  (identified by guid)
 │              ├── ownerId          ← display in container mode,
 │              │                      access input in commons mode
 │              ├── liveVersionId    → DefinitionVersion (published)
 │              ├── draftVersionId   → DefinitionVersion (latest upload)
 │              ├── computeServerId? (optional override)
 │              ├── DefinitionVersion[]   (immutable, monotonic v1, v2, …)
 │              │     ├── fileKey → blob in IStorageProvider
 │              │     └── schema  → cached UISchema (see schema-caching.md)
 │              └── ShareLink[]   (per-link tokens for unauth access)
 │
 └── ComputeServerConfig[]
       ├── PlatformComputeServer  (scope: 'platform', sharedWith: 'all' | string[])
       └── OrgComputeServer       (scope: 'org', ownerOrgId: string)
```

### Invariants

- **Org is the tenancy boundary** ([permissions.md §1](./permissions.md#1-mental-model)). Projects,
  org members and invites carry `orgId`. Definitions, versions and share links reach their org
  through their project.
- **Definitions live inside projects.** Deleting a project cascades.
- **A user can belong to multiple orgs.** Every request carries an `actingOrgId`; tenancy checks
  compare it to the resource's org, never "is the user in some matching org".

---

## 3. The entities, in detail

### 3.1 User

Owned by `IAuthProvider`, not by the data layer, which references users only by opaque `userId`.
Selva-side state (display name, starred definitions, recent runs) lives in `UserProfile`
(`IUserProfileStore`); platform permissions live in `IPlatformPermissionStore`. The split keeps
external IdPs from having to model anything Selva-specific: see
[permissions.md §2](./permissions.md#2-platform-scope), which also holds the
at-least-one-`instance_admin` invariant.

### 3.2 Organization

Roles and org permissions: [permissions.md §3](./permissions.md#3-org-scope).

`SELVA_TENANCY=single` (default) provisions one org at setup and resolves every user's
`actingOrgId` to it. `multi` makes orgs first-class. The multi-org URL namespace is reserved but
not routed: see [ADR 0006](../adr/0006-multi-org-url-shape-and-reserved-slugs.md).

### 3.3 Project

Lives in one org; `slug` is unique per org, not globally. Visibility, roles and the container and
commons models (`autoJoinOnUpload`) are in [permissions.md §4](./permissions.md#4-project-scope);
Reclaim is under `canReclaim` in §5.

### 3.4 Definition

- `guid` is immutable and public-facing; `projectId` points at the parent project.
- `status` includes `pending`, an internal state between the metadata write and the blob upload.
  List endpoints hide `pending` and `archived` unless asked.
- `coverImage` is a public URL; uploads are transcoded to WebP, max 1200px, q=85
  ([storage/image.ts](../../packages/platform/src/storage/image.ts)).

### 3.5 DefinitionVersion

`versionNumber` is monotonic and never reused, even after the latest version is deleted
(`nextVersionNumber` on the record). `fileKey` resolves through `IStorageProvider`. The cached
`schema` is covered by [schema-caching.md](./schema-caching.md).

Immutability, the live and draft pointers, rollback and deletion protection:
[permissions.md §6](./permissions.md#6-definition-versioning).

### 3.6 ShareLink

Per-definition, per-channel grant for unauthenticated access; the only anonymous-access mechanism.
Gated by `ENABLE_SHARING`. Design, token resolution and cascade:
[permissions.md §7](./permissions.md#7-share-links).

### 3.7 Invite

Org-scoped only. `/accept-invite` is unauthenticated by design: the token is the capability, so
`getByTokenHash` and `markAccepted` accept `SYSTEM_CONTEXT`.

### 3.8 ComputeServerConfig

Platform and org-private servers, layered defaults, and the resolution order are in
[permissions.md §3](./permissions.md#compute-servers-sharing-defaults).
`serversVisibleTo(config, orgId)`
([computeServer/utils.ts](../../packages/platform/src/computeServer/utils.ts)) is the shared
visibility helper every picker and the resolver use.

---

## 4. Provider abstraction

`@selvajs/platform` defines only TypeScript interfaces, Zod schemas, pure rule functions, and shared
utilities. No I/O. The interface list and the conformance suites every provider must pass are in
[packages/platform/README.md](../../packages/platform/README.md).

|                     | `@selvajs/local-provider`                          | `@selvajs/supabase-provider`                    |
| ------------------- | -------------------------------------------------- | ----------------------------------------------- |
| Identity            | `LocalAuthProvider` (HMAC sessions, password auth) | `SupabaseAuthProvider` (JWT)                    |
| Data                | JSON files under `DATA_PATH/`                      | Postgres + RLS                                  |
| Blobs               | Filesystem under `DATA_PATH/`                      | Supabase Storage buckets                        |
| Tenancy enforcement | Code-level scoping in store methods                | RLS policies, scoped via `adapterContext` (JWT) |

`@selvajs/header-auth-provider` implements `IAuthProvider` only; data and storage come from another
provider.

Cross-store orchestration lives outside platform: the definition service, render loader, and
schema extraction are in [`@selvajs/server/definitions`](../../packages/server/src/definitions), wired to the
app's providers by [`#lib/server/definitions/`](../../packages/selva/src/lib/server/definitions).

**Selection** is environment-driven: `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` /
`SELVA_STORAGE_PROVIDER` resolved by `createSelvaProviders`
([packages/server/src/providers/](../../packages/server/src/providers)) against the registry in
[providers.server.ts](../../packages/selva/src/lib/server/providers.server.ts). `SELVA_CONFIG_PATH` points at an
external `selva.config.js` for a provider not bundled in the app. Not switchable per request.

---

## 5. Request lifecycle

[hooks.server.ts](../../packages/selva/src/hooks.server.ts) builds the `RequestContext` for every
request. A bearer API token is resolved first (`resolveApiToken`) and decides the request on its
own; otherwise the session cookie goes through `providers.auth.verifyToken`, and `attachSession`
loads the profile and platform permissions and calls `buildRequestContext`. `actingOrgId` is the
user's first org membership; an instance admin with none falls back to the first org.

**`RequestContext` is the security currency.** Every store method takes it first, and adapters must
scope queries by it: the query is the security boundary, never the route handler trusting itself.

---

## 6. Storage paths

Built through [`definitionPaths`](../../packages/platform/src/definitions/paths.ts)
(`definitions/{guid}/versions/v{n}.{ext}`, `cover.webp`, and the `definitions/{guid}/` cascade-delete
prefix), never string-concatenated ad hoc. `assertSafeKey()` admits only `[A-Za-z0-9._-]` segments and
rejects `.` and `..`, so an id cannot escape its prefix.

---

## 7. Build and deployment

The Compute app is standalone SvelteKit. Provider selection, tenancy, feature flags, and secrets are
env vars: [.env.example](../../packages/selva/.env.example) is authoritative. The compute server URL
and API key are not env: they are configured at `/admin/compute` and persisted through
`IComputeServerStore`. Setup is in [quick-start.md](../self-hosting/get-started/quick-start.md).

---

## 8. Data privacy

Selva holds personal data, and **the operator is the data controller**, not the auth provider. The
provider abstraction moves where _credentials_ live (Supabase `auth.users` vs the local provider's
`auth-users.json`); it does not move Selva out of the compliance surface.
[Data privacy](../self-hosting/concepts/data-privacy.md) is the authoritative inventory of what is
stored and what erasure reaches.

---

## 9. Not covered here

- **Access-control rules**: [permissions.md](./permissions.md).
- **Grasshopper plugin internals**: [plugin-context.md](./plugin-context.md).
- **Frontend component architecture**: [packages/ui/CONTEXT.md](../../packages/ui/CONTEXT.md).
- **Rhino.Compute topology**:
  [docs/self-hosting/get-started/rhino-compute.md](../self-hosting/get-started/rhino-compute.md).

---

## 10. Designed for, not yet wired

| Item                                      | What's missing                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Channel UX**                            | Editors can't toggle live/draft in the UI; the share-link minter doesn't pin a channel      |
| **`ALLOW_ORG_CREATION` enforcement**      | The flag exists and is surfaced on `/admin/system`; no end-user org-creation route reads it |
| **Multi-tenant `actingOrgId` resolution** | Resolves to first membership; the `/o/{slug}/` namespace is reserved but not routed         |
| **Cross-org guests on private projects**  | [permissions.md §12](./permissions.md#12-deferred-tracked-not-built)                        |
