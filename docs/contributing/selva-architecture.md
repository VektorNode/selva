# Selva — Architecture

Internal reference for checking code against intended design. Companion to
[Access Control](./permissions.md), which owns _who can do what_; this document owns _what exists
and how it fits together_.

---

## 1. What Selva is

Selva takes a Grasshopper definition and exposes it as a configurable web application — schema-driven
UI on top, Rhino.Compute solving on the backend. Two runtime modes share one schema:

- **Plugin UI** (`@selvajs/plugin-ui`) — the designer's companion, embedded into the Grasshopper
  plugin. Talks to a running Grasshopper over WebSocket, hot-reloads as the schema is edited.
- **Compute app** (`@selvajs/selva`) — the deployed product. Standalone, multi-user, solves through
  Rhino.Compute.

[packages/schemas/ui-schema.json](../../packages/schemas/ui-schema.json) is the source contract: it generates
TypeScript for the web stack and C# for the plugin, so UI and parameter shapes cannot drift.

The two runtimes are **independent**. They communicate only through the shared schema format and the
`.gh` / `.ghx` file the designer uploads.

---

## 2. Entity model

```
Instance (one Selva deployment)
 ├── User (identity, owned by IAuthProvider)
 │    └── UserProfile (displayName, starredDefinitions, recentRuns)
 │
 ├── PlatformPermission(userId, permission)      ← IPlatformPermissionStore
 │                                                  (instance_admin, manage_compute, …)
 │
 ├── Organization                                ← hard tenancy boundary
 │    ├── OrgMember (User × Org)
 │    │    ├── role: owner | admin | member
 │    │    └── permissions[]   (manage_org_members, manage_definitions, …)
 │    ├── Invite (pending email → org + role)
 │    ├── ComputeServerConfig (optional org override)
 │    └── Project
 │         ├── visibility: private | org | public | platform
 │         ├── autoJoinOnUpload: bool   ← container vs commons mode
 │         ├── ProjectMember (User × Project) — role: owner | editor | viewer
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
 │                    ├── channel: live | draft
 │                    ├── allowSolve, maxSolves, expiresAt, revokedAt
 │                    └── tokenHash (HMAC; raw shown once at mint)
 │
 └── ComputeServerConfig[]
       ├── PlatformComputeServer  (scope: 'platform', sharedWith: 'all' | string[])
       └── OrgComputeServer       (scope: 'org', ownerOrgId: string)
```

### Invariants

- **Org is the tenancy boundary.** Every tenant-owned row carries `orgId`. Nothing crosses orgs
  except `public` projects (gated by `ALLOW_CROSS_ORG_PUBLIC`) and `platform` projects reached
  through an explicit grant.
- **Definitions live inside projects.** Deleting a project cascades.
- **Versions are immutable.** Mutations create new rows; `live` and `draft` are pointers.
- **Sharing is per-definition.** Anonymous access is delivered only via `ShareLink` tokens. There is
  no project-level anonymous flag.
- **A user can belong to multiple orgs.** Every request carries an `actingOrgId` that the rule layer
  compares against the resource's `orgId`.

---

## 3. The entities, in detail

### 3.1 User

Owned by `IAuthProvider`, not by the data layer, which references users only by opaque `userId`.
Selva-side state (display name, starred definitions, recent runs) lives in `UserProfile`
(`IUserProfileStore`); platform permissions live in `IPlatformPermissionStore`. The split keeps
external IdPs from having to model anything Selva-specific — see
[permissions.md §2](./permissions.md#2-platform-scope).

**Invariant:** at least one user always holds `instance_admin`; the data layer rejects the operation
that would zero it out.

### 3.2 Organization

`id`, `slug` (unique, URL-safe), `ownerId` (transferable), `createdBy` (immutable), soft-delete via
`deletedAt`. Membership via `OrgMember(orgId, userId, role, permissions[])` — `owner`/`admin` get
every org permission; `member` gets none and can be granted `manage_definitions` and/or
`manage_projects`.

`SELVA_TENANCY=single` (default) provisions one org at setup and resolves every user's
`actingOrgId` to it. `multi` makes orgs first-class. The multi-org URL namespace is reserved but
not routed — see [ADR 0006](../adr/0006-multi-org-url-shape-and-reserved-slugs.md).

### 3.3 Project

Lives in one org (`orgId`, never null). `slug` is unique per org, not globally.

`visibility`: `private` (members only), `org` (any org member), `public` (any authenticated user,
optionally cross-org), `platform` (instance admins plus explicit grants — gated by
`ENABLE_PLATFORM_PROJECTS`).

Roles: `owner`, `editor`, `viewer`. `viewer` is for stakeholders who solve and download but cannot
modify.

Two project models, selected per-project by `autoJoinOnUpload`:

- **Container** (default, `false`): project role is authoritative. `Definition.ownerId` is
  display-only.
- **Commons** (`true`, `public` projects only): any authenticated user can upload a _new_ definition
  and owns it; they cannot modify anyone else's. Project owner/editor keep moderation authority.

Full semantics in [permissions.md §4](./permissions.md#4-project-scope).

**Reclaim:** an org owner/admin can add themselves as co-owner of any project in their org when the
original owner is unreachable. It does not demote the original owner.

### 3.4 Definition

- `guid` — immutable, public-facing. `projectId` FK to the parent project.
- `ownerId` set at creation, never changes.
- `status`: `pending | draft | published`. `pending` covers the window between metadata-write and
  blob-upload; list endpoints filter it out unless `includePending`.
- `runCount` increments per solve. `liveVersionId` / `draftVersionId` point at version rows.
- `coverImage` is a public URL; uploads are transcoded to WebP, max 1200px, q=85
  ([storage/image.ts](../../packages/platform/src/storage/image.ts)).
- `computeServerId` optional override — falls back to org default, then instance default.

### 3.5 DefinitionVersion

`(id, definitionId, versionNumber, fileExt, fileKey, originalFilename?, uploadedBy, uploadedAt,
schema?, schemaExtractedAt?)`. `versionNumber` is monotonic and never reused; `fileKey` resolves
through `IStorageProvider` at `definitions/{guid}/versions/v{n}.{ext}`.

A version cannot be deleted while referenced by `liveVersionId` or `draftVersionId` (FK
`ON DELETE RESTRICT` in Postgres, explicit check in the local provider) — returns 409. Rollback is a
re-point of `liveVersionId`, not a re-upload.

The cached `schema` is covered by [schema-caching.md](./schema-caching.md).

### 3.6 ShareLink

Per-definition, per-channel grant for unauthenticated access; the only anonymous-access mechanism.
Gated by `ENABLE_SHARING`.

The raw token is shown to the minter **once** at creation
(`POST /api/v1/definitions/[guid]/share-links`); only the HMAC `tokenHash` is persisted. Resolution
HMACs the supplied token, looks up by hash, checks revocation/expiry/cap/parent-status, and builds a
synthetic `RequestContext` scoped to the token, skipping user-based rules. Definition soft-delete
fails tokens closed; hard-delete cascades them out.

Full design in [permissions.md §7](./permissions.md#7-share-links).

### 3.7 Invite

Org-scoped only — you invite to an org; project membership is managed within-org.
`(id, token, email, orgId, orgRole, orgPermissions[], invitedBy, expiresAt, acceptedAt?,
acceptedByUserId?)`. The token is the capability, so `getByToken` and `markAccepted` accept
`SYSTEM_CONTEXT` — `/accept-invite` is unauthenticated by design.

### 3.8 ComputeServerConfig

Discriminated by `scope`:

- `PlatformComputeServer` — `sharedWith: 'all' | string[]`. Created by `manage_compute`.
- `OrgComputeServer` — `ownerOrgId`. Created by an org owner/admin with `manage_org_compute`, gated
  by `ALLOW_ORG_COMPUTE_OVERRIDE`.

Defaults are layered: a global `defaultServerId` (must reference a platform server, and is **always**
usable by every org regardless of `sharedWith`) plus per-org `orgDefaults[orgId]`.

Resolution, narrowest wins: per-definition pin → per-org default → global default. A pin to a
no-longer-visible server falls through silently. `serversVisibleTo(config, orgId)`
([computeServer/utils.ts](../../packages/platform/src/computeServer/utils.ts)) is the shared visibility
helper every picker and the resolver use.

---

## 4. Provider abstraction

`@selvajs/platform` defines only TypeScript interfaces, Zod schemas, pure rule functions, and shared
utilities. No I/O.

|                     | `@selvajs/local-provider`                          | `@selvajs/supabase-provider`                    |
| ------------------- | -------------------------------------------------- | ----------------------------------------------- |
| Identity            | `LocalAuthProvider` (HMAC sessions, password auth) | `SupabaseAuthProvider` (JWT)                    |
| Data                | JSON files under `DATA_PATH/`                      | Postgres + RLS                                  |
| Blobs               | Filesystem under `DATA_PATH/`                      | Supabase Storage buckets                        |
| Tenancy enforcement | Code-level scoping in store methods                | RLS policies, scoped via `adapterContext` (JWT) |

`@selvajs/header-auth-provider` implements `IAuthProvider` only — pair it with either data/storage
provider.

| Interface                    | Location                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `IAuthProvider`              | [`@selvajs/platform/auth`](../../packages/platform/src/auth/interface.ts)                         |
| `IDataProvider`              | [`@selvajs/platform/data`](../../packages/platform/src/data/interface.ts)                         |
| `IOrgStore`                  | [`@selvajs/platform/organizations`](../../packages/platform/src/organizations/interface.ts)       |
| `IProjectStore`              | [`@selvajs/platform/projects`](../../packages/platform/src/projects/interface.ts)                 |
| `IDefinitionStore`           | [`@selvajs/platform/definitions`](../../packages/platform/src/definitions/interface.ts)           |
| `IComputeServerStore`        | [`@selvajs/platform/computeServer`](../../packages/platform/src/computeServer/interface.ts)       |
| `IShareLinkStore`            | [`@selvajs/platform/shareLinks`](../../packages/platform/src/shareLinks/interface.ts)             |
| `IPlatformProjectGrantStore` | [`@selvajs/platform/platformProjects`](../../packages/platform/src/platformProjects/interface.ts) |
| `IInviteStore`               | [`@selvajs/platform/invites`](../../packages/platform/src/invites/interface.ts)                   |
| `IStorageProvider`           | [`@selvajs/platform/storage`](../../packages/platform/src/storage/interface.ts)                   |
| `IUserProfileStore`          | [`@selvajs/platform/userProfile`](../../packages/platform/src/userProfile/interface.ts)           |
| `IPlatformPermissionStore`   | [`@selvajs/platform/permissions`](../../packages/platform/src/permissions/interface.ts)           |
| `IEventSink`                 | [`@selvajs/platform/events`](../../packages/platform/src/events/interface.ts)                     |

`IDataProvider` also carries optional `auditQuery` / `events` hooks, a `schemaVersion` handshake, and
the `ensureUser` / `onUserDeleted` lifecycle methods.

Cross-store orchestration lives outside platform: the definition service, render loader, and
schema extraction are in [`@selvajs/server/definitions`](../../packages/server/src/definitions), wired to the
app's providers by [`$lib/server/definitions/`](../../packages/selva/src/lib/server/definitions).

**Conformance:** `@selvajs/platform/testing` exports framework-agnostic suites every provider runs
against. A new provider must pass them to be drop-in.

**Selection** is environment-driven — `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` /
`SELVA_STORAGE_PROVIDER` resolved by `createSelvaProviders`
([packages/server/src/providers/](../../packages/server/src/providers)) against the registry in
[providers.server.ts](../../packages/selva/src/lib/server/providers.server.ts). `SELVA_CONFIG_PATH` points at an
external `selva.config.js` for a provider not bundled in the app. Not switchable per request.

---

## 5. Request lifecycle

Every request flows through [hooks.server.ts](../../packages/selva/src/hooks.server.ts):

1. Public-route shortcut (login, setup, accept-invite, logout, auth callbacks) — pass through.
2. Session cookie → `providers.auth.verifyToken(token)` → `AuthUser` or 401.
3. Load `UserProfile`.
4. Build `RequestContext`: resolve `actingOrgId` (first org membership, falling back to the first org
   for instance admins), load that org's `OrgMember.permissions`, attach `adapterContext` (e.g. the
   Supabase JWT for RLS).
5. Stash on `event.locals`.

**`RequestContext` is the security currency.** Every store method takes it first, and adapters must
scope queries by it — the query is the security boundary, never the route handler trusting itself.

---

## 6. Storage paths

Built through [`@selvajs/platform/definitions/paths.ts`](../../packages/platform/src/definitions/paths.ts),
never string-concatenated ad hoc:

| Path                                     | Purpose                                     |
| ---------------------------------------- | ------------------------------------------- |
| `definitions/{guid}/versions/v{n}.{ext}` | A definition file                           |
| `definitions/{guid}/cover.webp`          | Cover image (always WebP after transcoding) |
| `definitions/{guid}/`                    | Cascade-delete prefix on definition removal |

`assertSafeKey()` rejects `..`, absolute markers, separators, and NUL.

---

## 7. Schema generation

```
packages/schemas/ui-schema.json
        ├─→ pnpm generate:ts → packages/schemas/src/generated/schema.ts
        └─→ pnpm generate:cs → Plugin/Selva.Schema/Models/UISchema.Generated.cs
```

Edit `ui-schema.json`, run `pnpm generate`. CI fails on drift.

---

## 8. Build and deployment

**Plugin + plugin UI.** `pnpm dev:plugin` runs the schema designer on `:5173`; the plugin is built
with `dotnet build` and connects back over WebSocket. `pnpm build:plugin` builds the web assets,
embeds them as `EmbeddedResource`, and produces one self-contained `.gha` (net48 + net7.0 for
Rhino 8, net9.0 for Rhino 9). The plugin allocates a local HTTP port at runtime to serve them.

**Compute app.** Standalone SvelteKit deployment. Provider selection, tenancy, feature flags, and
secrets are all env vars — [.env.example](../../packages/selva/.env.example) is authoritative. `PORT` defaults to 3000.
The compute server URL and API key are configured at `/admin/compute` and persisted through
`IComputeServerStore`, never via env. `npx @selvajs/cli` generates the deployment directory, including a PM2 `ecosystem.config.cjs`.

---

## 9. Data privacy

Selva minimizes the personal data it holds, but it holds some, and **the operator is the data
controller** — not the auth provider. [CLAUDE.md](../../CLAUDE.md#data-privacy) is the
authoritative inventory of what is stored and what erasure reaches. The provider abstraction moves
where _credentials_ live (Supabase `auth.users` vs the local provider's own `auth-users.json`); it
does not move Selva out of the compliance surface.

---

## 10. Not covered here

- **Access-control rules** — [permissions.md](./permissions.md).
- **Grasshopper plugin internals** — [plugin-context.md](./plugin-context.md).
- **Frontend component architecture** — [packages/ui/CONTEXT.md](../../packages/ui/CONTEXT.md).
- **Rhino.Compute topology** —
  [docs/self-hosting/get-started/rhino-compute.md](../self-hosting/get-started/rhino-compute.md).
- **`@selvajs/compute`** — the published Rhino.Compute client library, a dependency rather than a
  Selva component.

---

## 11. Designed for, not yet wired

| Item                                      | What's missing                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Channel UX**                            | Editors can't toggle live/draft in the UI; the share-link minter doesn't pin a channel      |
| **`ALLOW_ORG_CREATION` enforcement**      | The flag exists and is surfaced on `/admin/system`; no end-user org-creation route reads it |
| **Multi-tenant `actingOrgId` resolution** | Resolves to first membership; the `/o/{slug}/` namespace is reserved but not routed         |
| **Cross-org guests on private projects**  | [permissions.md §12](./permissions.md#12-deferred-tracked-not-built)                        |
