# Selva — Architecture Spec

> **Purpose.** Internal reference for checking code against intended design. When a route, store, or rule looks suspicious, this is the document you verify against. Companion to [Access Control](./Permissions.md), which owns _who can do what_; this document owns _what exists and how it fits together_.
>
> **Audience.** Selva contributors. Not aimed at integrators or evaluators.
>
> **Last reconciled with code:** 2026-04-25.

---

## 1. What Selva is

Selva is a system for taking a Grasshopper definition (a parametric model authored by a designer in Rhino/Grasshopper) and exposing it as a configurable web application — schema-driven UI on top, Rhino.Compute solving on the backend. Two interchangeable runtime modes share one schema:

- **Builder mode** (`@selvajs/builder-app`) — the designer's local-development companion. Lives next to a running Grasshopper instance, talks to it over WebSocket, hot-reloads as the schema is edited.
- **Compute mode** (`@selvajs/compute-app`) — the deployed product. A standalone web app that solves definitions through Rhino.Compute. Multi-user, account-backed, hostable.

A single `ui-schema.json` ([packages/schemas/ui-schema.json](../../schemas/ui-schema.json)) is the source contract: it generates TypeScript for the web stack and C# for the plugin. UI shapes and parameter shapes cannot drift.

---

## 2. Layered topology

```
┌─────────────────────────────────────────────────────────────────┐
│  Rhino + Grasshopper (designer's machine)                       │
│  ┌─────────────────────────────────────────────────┐            │
│  │  Selva.GH (.gha plugin, net48 + net7.0)        │            │
│  │  - UIBuilder component                          │            │
│  │  - WebSocket server :8765                       │            │
│  │  - Embedded HTTP server (dev assets)            │            │
│  └─────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
            │ WebSocket (schema sync, dev only)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Builder app (local SvelteKit, dev mode)                        │
│  - Drag-and-drop schema designer                                │
│  - Talks to one local Grasshopper instance                      │
└─────────────────────────────────────────────────────────────────┘

──────────────── separate deployment ─────────────────────────────

┌─────────────────────────────────────────────────────────────────┐
│  Compute app (deployed SvelteKit)                               │
│  ┌───────────────────────────────────────────────┐              │
│  │  Routes: /admin, /app, /api/*                 │              │
│  │  hooks.server.ts: auth + RequestContext       │              │
│  └───────────────────────────────────────────────┘              │
│            │                                                    │
│            ▼                                                    │
│  ┌───────────────────────────────────────────────┐              │
│  │  @selvajs/platform — provider INTERFACES        │              │
│  │  IAuthProvider, IDataProvider, IStorage, …    │              │
│  └───────────────────────────────────────────────┘              │
│            │                                                    │
│  ┌─────────┴──────────────┐                                     │
│  ▼                        ▼                                     │
│  @selvajs/local-provider     @selvajs/supabase-provider              │
│  (FS + JSON, single-     (Postgres + RLS + storage              │
│   tenant, self-hosted)    bucket, multi-tenant SaaS)            │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Rhino.Compute (custom fork: VektorNode/compute.rhino3d)        │
│  - Solves .gh / .ghx files                                      │
│  - Configured per-instance and optionally per-org override      │
└─────────────────────────────────────────────────────────────────┘
```

The plugin and the deployed compute app are **independent runtimes**. They communicate only through the shared schema format and the definition file (`.gh` / `.ghx`) the designer uploads.

---

## 3. Entity model

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
 │    │
 │    ├── Invite (pending email → org + role)
 │    │
 │    ├── ComputeServerConfig (optional org override)
 │    │
 │    └── Project
 │         ├── visibility: private | org | public
 │         ├── autoJoinOnUpload: bool   ← container vs commons mode
 │         ├── ProjectMember (User × Project)
 │         │    └── role: owner | editor | viewer
 │         │
 │         └── Definition  (Grasshopper definition, identified by guid)
 │              ├── ownerId          ← display in container mode,
 │              │                      access input in commons mode
 │              ├── liveVersionId    → DefinitionVersion (published)
 │              ├── draftVersionId   → DefinitionVersion (latest upload)
 │              ├── computeServerId? (optional override)
 │              │
 │              ├── DefinitionVersion[]   (immutable, monotonic v1, v2, …)
 │              │     └── fileKey → blob in IStorageProvider
 │              │
 │              └── ShareLink[]   (per-link tokens for unauth access)
 │                    ├── channel: live | draft
 │                    ├── allowSolve, maxSolves, expiresAt, revokedAt
 │                    └── tokenHash (HMAC; raw shown once at mint)
 │
 └── ComputeServerConfig[]  (instance pool, orgId = null)
```

### Key invariants

- **Org is the tenancy boundary.** Every tenant-owned row carries `orgId`. No resource crosses orgs except `public` projects (cross-org public is itself gated by a platform flag).
- **Definitions live inside projects.** A definition cannot exist outside a project; deleting a project cascades.
- **Versions are immutable.** Mutations create new `DefinitionVersion` rows. `live` and `draft` are pointers, not copies.
- **Sharing is per-definition, not per-project.** Anonymous / no-account access is delivered exclusively via `ShareLink` tokens. There is no `Project.allowAnonymous` flag.
- **A user can belong to multiple orgs.** Permissions in one org are independent of another. Every request has an `actingOrgId` that the rule layer compares against the resource's `orgId`.

---

## 4. The entities, in detail

### 4.1 User

- Owned by `IAuthProvider`, **not** by the data layer. This means user identity, credentials, MFA, and PII never live in Selva's stores — they live in whatever provider you plug in (local HMAC, Supabase Auth, future: Entra/Firebase/OIDC).
- The data layer references users only by opaque `userId` strings.
- Selva-side state about a user (display name, starred definitions, recent runs) lives in `UserProfile`, owned by `IUserProfileStore`. The split keeps OIDC-only providers honest — they don't have to stub out fields they don't own.
- Platform-level permissions (`instance_admin`, `manage_compute`, `manage_instance_users`, `manage_updates`) live in `IPlatformPermissionStore`, separate from `AuthUser`. The auth provider owns identity; Selva owns authorization, so external IdPs (Supabase Auth, OIDC) don't have to model anything Selva-specific. See [Permissions.md §2](./Permissions.md#2-platform-scope).
- **Invariant:** at least one user always holds `instance_admin`. The auth provider rejects the operation that would zero this out.

### 4.2 Organization

- Tenant. Has `id`, `slug` (unique, URL-safe), `ownerId` (transferable), `createdBy` (immutable audit), soft-delete via `deletedAt`.
- **Membership** via `OrgMember(orgId, userId, role, permissions[])`:
  - Roles: `owner`, `admin`, `member`. Owner/admin get all org permissions by default; `member` gets none and can be granted `manage_definitions` and/or `manage_projects`.
  - `manage_org_members` and `manage_org_compute` are owner/admin-only and not grantable to `member`.
- **First release is single-tenant self-hosted.** One org provisioned at install time; the instance admin is typically also the org owner, and the UI merges the two views.
- **Multi-tenant SaaS (hosted by Selva) is a planned future deployment**, not a current one. The data model, provider abstraction, RLS-ready tenancy boundaries, and `IOrgStore` are all already in place to support it without a schema migration. What's _not_ yet wired: self-service org creation UX, URL-based org routing, the `ALLOW_ORG_CREATION` flag enforcement.

### 4.3 Project

- Lives inside one org (`orgId` FK, never null).
- `slug` is URL-safe and unique **per org**, not globally.
- `visibility`: `private` (members only), `org` (any org member), `public` (any authenticated user, optionally cross-org).
- **Membership** via `ProjectMember(projectId, userId, role)`:
  - Roles: `owner`, `editor`, `viewer`.
  - `viewer` exists for stakeholders/clients/auditors who solve and download but cannot modify.
- **Two project models** selected per-project by `autoJoinOnUpload`:
  - **Container** (default, `false`): project role is authoritative. Only `owner`/`editor` can upload or edit anything. `Definition.ownerId` is display-only.
  - **Commons** (`true`, only on `public` projects): anyone authenticated can upload a _new_ definition and becomes its owner. They cannot modify other people's definitions. Project owner/editor retain moderation authority.
  - Full semantics in [Permissions.md §4](./Permissions.md#4-project-scope).
- **Reclaim:** org owner/admin can add themselves as co-owner of any project in their org as an escape hatch when the original owner is unreachable. Does not demote the original owner — leaves an audit trail.

### 4.4 Definition

A Grasshopper definition (`.gh` or `.ghx`) plus its metadata.

- Identified by `guid` (immutable, public-facing).
- `projectId` FK to parent project.
- `ownerId` set at creation, never changes. In container mode it's display metadata; in commons mode it's an access input.
- `status`: `pending | draft | published`. `pending` is internal — covers the window between metadata-write and blob-upload-complete; janitor sweeps stale rows; filtered out of list endpoints by default. `draft` and `published` are the editorial states. Add more states later if a real workflow needs them.
- `runCount` increments atomically per solve. `liveVersionId` and `draftVersionId` point at version rows (see §4.5).
- `coverImage` is a public URL; uploads are unconditionally transcoded to WebP, max 1200px, q=85 (see [storage/image.ts](../../platform/src/storage/image.ts)).
- `computeServerId` optional override — falls back to org default, then instance default.

### 4.5 DefinitionVersion

- Immutable row: `(id, definitionId, versionNumber, fileExt, fileKey, originalFilename?, uploadedBy, uploadedAt)`.
- `versionNumber` is monotonic per definition, never reused.
- `fileKey` resolves through `IStorageProvider`. Path scheme: `definitions/{guid}/versions/v{n}.{ext}`.
- **Channels** (`live`, `draft`) are pointers maintained on the `Definition` row, not properties of the version itself.
- **Deletion protection:** a version cannot be deleted while referenced by `liveVersionId` or `draftVersionId` (FK `ON DELETE RESTRICT` in Postgres; explicit check in local provider). Returns 409.
- **Rollback** is a re-point of `liveVersionId`, not a re-upload.
- **Data model is complete; UI is not.** The compute-app does not yet expose channel toggling to editors or pin share-link holders to a channel via the UI. Backend is intentionally finalized first; channel UX comes after.

### 4.6 ShareLink

Per-definition, per-channel grant for unauthenticated access. **Replaces all anonymous-access mechanisms.**

- `(id, definitionId, channel, tokenHash, allowSolve, maxSolves, expiresAt, revokedAt, solveCount, …)`.
- Raw token shown to the minter **once** at creation (`POST /api/definitions/[guid]/share-links`); only `tokenHash` (HMAC) persisted.
- Resolution: HMAC the supplied token, look up by hash, check revocation/expiry/cap/parent-status, build a synthetic `RequestContext` scoped to the token, skip user-based rules.
- Default cap: `maxSolves = 1000` (a denial-of-wallet protection, since iframe-embedded tokens are publicly visible by design).
- Cascades: definition soft-delete → tokens fail closed; definition hard-delete → tokens FK-cascade.
- Full design in [Permissions.md §7](./Permissions.md#7-share-links).

### 4.7 Invite

- Org-scoped only. You invite to an org; project membership is managed within-org.
- `(id, token, email, orgId, orgRole, orgPermissions[], invitedBy, expiresAt, acceptedAt?, acceptedByUserId?)`.
- Token is the capability — `getByToken` and `markAccepted` accept `SYSTEM_CONTEXT` (the public `/accept-invite` page is unauthenticated by design).
- **Cross-org project guests are deferred** ([Permissions.md §12](./Permissions.md#12-deferred-tracked-not-built)).

### 4.8 ComputeServerConfig

- Configuration of a Rhino.Compute endpoint: `(id, orgId?, label, serverUrl, apiKey?, timeoutMs?, retryCount?)`.
- **Three-tier resolution**, narrowest wins:
  1. **Per-definition** (`Definition.computeServerId`) — for routing individual heavy definitions to beefier (more expensive) hardware while light ones stay on cheap servers.
  2. **Per-org** override (`ComputeServerConfig.orgId = <org>`) — for the future SaaS deployment where companies bring their own servers alongside Selva's defaults. Configured by org owner/admin with `manage_org_compute`.
  3. **Instance pool** (`ComputeServerConfig.orgId = null`) — configured by `instance_admin`. Always the fallback.
- The override can never affect the instance pool. An org misconfiguring their compute only breaks their own solves.
- **`ALLOW_ORG_COMPUTE_OVERRIDE` flag** is enforced in two places: [`resolve.server.ts`](../src/lib/server/compute/resolve.server.ts) skips the per-org override during resolution when the flag is off, and [`/api/org/compute`](../src/routes/api/org/compute/+server.ts) returns 403 when callers try to configure one. With single-tenant self-hosted as the current target the flag is typically off, collapsing to the instance pool; flipping it on is what unlocks BYO compute.

### 4.9 UserProfile

- Selva-side user state, distinct from auth identity. `(userId, displayName?, starredDefinitions[], recentRuns[])`.
- Loaded on every authenticated request (`hooks.server.ts`).
- `recentRuns` capped to a recent window, deduped by `definitionId`.

---

## 5. Provider abstraction

`@selvajs/platform` defines _only_ TypeScript interfaces, Zod schemas, pure rule functions, and shared utilities. No I/O. Two providers implement the contract today:

|                     | `@selvajs/local-provider`                                 | `@selvajs/supabase-provider`                      |
| ------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| Identity            | `LocalAuthProvider` (HMAC sessions, optional password) | `SupabaseAuthProvider` (JWT, MFA-capable)       |
| Data                | JSON files under `DATA_PATH/`                          | Postgres + RLS                                  |
| Blobs               | Filesystem under `DATA_PATH/`                          | Supabase Storage bucket                         |
| User profile        | JSON file                                              | `user_profiles` table                           |
| Tenancy enforcement | Code-level scoping in store methods                    | RLS policies, scoped via `adapterContext` (JWT) |
| Use case            | Self-hosted single-tenant, dev, embedded               | Multi-tenant SaaS, managed                      |

**Interfaces:**

| Interface                                                                                                   | Location                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `IAuthProvider`                                                                                             | [`@selvajs/platform/auth`](../../platform/src/auth/interface.ts)               |
| `IDataProvider`, `IOrgStore`, `IProjectStore`, `IDefinitionStore`, `IComputeServerStore`, `IShareLinkStore` | [`@selvajs/platform/data`](../../platform/src/data/interface.ts)               |
| `IInviteStore`                                                                                              | [`@selvajs/platform/invites`](../../platform/src/invites/interface.ts)         |
| `IStorageProvider`                                                                                          | [`@selvajs/platform/storage`](../../platform/src/storage/interface.ts)         |
| `IUserProfileStore`                                                                                         | [`@selvajs/platform/userProfile`](../../platform/src/userProfile/interface.ts) |
| `IPlatformPermissionStore`                                                                                  | [`@selvajs/platform/permissions`](../../platform/src/permissions/interface.ts) |
| `IEventSink`                                                                                                | [`@selvajs/platform/events`](../../platform/src/events/interface.ts)           |

Orchestration (cross-store flows that aren't part of the provider contract) lives in compute-app, not platform — e.g. [`DefinitionService`](../src/lib/server/definitions/DefinitionService.ts) coordinates `IDefinitionStore` + `IStorageProvider` for upload/publish.

**Conformance:** `@selvajs/platform/testing` exports framework-agnostic conformance suites that every provider runs against. New providers must pass these to be considered drop-in.

**Provider selection** happens at compute-app startup via `$lib/server/providers.server.ts` — the choice is environment-driven, not runtime-switchable per request.

---

## 6. Request lifecycle (compute-app)

Every authenticated request flows through `hooks.server.ts`:

1. Public-route shortcut (login, setup, accept-invite, logout) — pass through.
2. Read session cookie → `providers.auth.verifyToken(token)` → `AuthUser` or 401.
3. Load `UserProfile` (via `IUserProfileStore`).
4. Build `RequestContext`:
   - Resolve `actingOrgId` — **today: the user's first org membership.** Works fine for single-tenant where every user has one membership. **Multi-tenant resolution is undecided** (URL prefix, subdomain, header, explicit org-switcher UI — all viable). This will need a deliberate choice before SaaS ships; see §12.
   - Load `OrgMember.permissions` for that org → `orgPermissions`.
   - Attach `adapterContext` (e.g., Supabase JWT for RLS).
5. Stash on `event.locals` for route loaders.

**`RequestContext` is the security currency.** Every store method takes it as the first argument. Adapters MUST scope queries by `ctx.actingOrgId` and permissions — the query itself is the security boundary, never the route handler trusting itself.

---

## 7. Storage paths and safety

Storage paths are constructed via immutable helpers in [`@selvajs/platform/definitions/paths.ts`](../../platform/src/definitions/paths.ts) — never string-built ad hoc:

| Path                                     | Purpose                                     |
| ---------------------------------------- | ------------------------------------------- |
| `definitions/{guid}/versions/v{n}.{ext}` | A definition file                           |
| `definitions/{guid}/cover.webp`          | Cover image (always WebP after transcoding) |
| `definitions/{guid}/`                    | Cascade-delete prefix on definition removal |

`assertSafeKey()` rejects `..`, absolute markers, separators, NUL — defense against path traversal. Image transcoding is unified across providers in `storage/image.ts`.

---

## 8. Schema generation pipeline

A single source generates types for both stacks:

```
packages/schemas/ui-schema.json
        │
        ├─→ pnpm generate:ts → packages/shared/src/lib/types/generated/schema.ts
        │
        └─→ pnpm generate:cs → Plugin/Selva.Core/Models/UISchema.Generated.cs
```

Workflow: edit `ui-schema.json` → run `pnpm generate:all` → both sides see the new shape on next build. UI shape and parameter shape cannot drift by design.

---

## 9. Build and deployment

### Builder app + plugin (designer's box)

- **Dev:** `pnpm dev` starts the SvelteKit builder app on `:5173`. Plugin built separately with `dotnet build`, loaded into Rhino, auto-connects to the dev server via WebSocket on `:8765`. Hot reload for the web side, IDE debugging for the plugin.
- **Production plugin:** `pnpm build:plugin` builds the web assets, copies them into `Plugin/Selva.GH/EmbeddedAssets/web/`, embeds them as `EmbeddedResource`, and produces a single self-contained `.gha` (multi-targeted: net48 for Rhino 7, net7.0 for Rhino 8). The plugin allocates a local HTTP port at runtime to serve the embedded assets.

### Compute app (deployed product)

- Standalone SvelteKit deployment.
- Provider selection is env-driven: `SELVA_PROVIDER=local` (default) or `SELVA_PROVIDER=supabase`. Local needs `DATA_PATH` + `SESSION_SECRET`; Supabase needs `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`. `PORT` defaults to 3000. The authoritative reference is [.env.example](../.env.example) — every var the app reads is documented inline there.
- Compute server URL/key configured in the admin UI (`/admin/compute`), persisted via `IComputeServerStore`. **Never** an env var.
- Example PM2 config: [`example.ecosystem.config.cjs`](../../../example.ecosystem.config.cjs).

---

## 10. Data privacy posture

Quoted from the project's stated stance (CLAUDE.md):

> User data isolation is by design. All authentication, credentials, and PII are owned exclusively by the auth provider. Selva stores only opaque session tokens, user IDs, permissions, and optional non-sensitive provider metadata.

This means Selva itself has zero exposure to GDPR-class data — the auth provider owns residency, retention, and breach surface. The provider abstraction is the load-bearing piece for this claim: any new provider must keep the line in the same place.

---

## 11. What this spec deliberately does not cover

- **Access control rules** — see [Permissions.md](./Permissions.md). It is the authority on `canView`/`canEdit`/`canSolve`/etc.
- **The Grasshopper plugin internals** (component anatomy, schema-link protocol, embedded HTTP server). Out of scope here; would belong in a `Plugin/ARCHITECTURE.md`.
- **Frontend component architecture** (Svelte stores, theming, shared UI library). Out of scope; tracked in `packages/compute-app/UI_INVENTORY.md` and `@selvajs/shared`.
- **Rhino.Compute server topology** (single instance vs pool vs ours-vs-theirs). See `docs/RHINO_COMPUTE.md`.

---

## 12. Design-ready, not yet wired

Things the architecture supports today but no code path exercises yet. These are deliberate gaps, not oversights — backend was finalized first.

| Item                                      | What's missing                                                                                                         | Becomes load-bearing when                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Channel UX in compute-app**             | Editors can't toggle live/draft in the UI; share-link minter UI doesn't pin channel                                    | Editors need to test draft solves in-app                    |
| **`ALLOW_ORG_CREATION` enforcement**      | Platform flag exists in `SelvaFlags`; no route consults it                                                             | SaaS multi-tenant ships and self-service org creation lands |
| **Multi-tenant `actingOrgId` resolution** | Today resolves to first membership; no URL-prefix / subdomain / org-switcher UX                                        | A user can belong to >1 org in a real deployment            |
| **Self-service org creation**             | `/admin/api/orgs` exists for instance-admin; no end-user create flow                                                   | SaaS multi-tenant ships                                     |
| **Cross-org guests on private projects**  | Permissions.md §12 deferred                                                                                            | First customer asks for it                                  |
| **Audit-log viewer UI**                   | `SupabaseEventSink` already persists every domain event to `public.audit_events`; operator-facing browser UI not built | Operators need to read the trail without opening the DB     |

> Pre-release: trimming any of these from code is free. There is no installed base to maintain compatibility with.

---

## 13. Out of scope for this spec

For grounding — these exist but live outside this document:

- **`@selvajs/builder-app`** — designer's local schema editor, embedded as a website inside the Grasshopper plugin. Hosted and maintained by Selva internally; not a deployable product.
- **`selva-compute`** (external npm package) — author's helper library for working with Rhino.Compute and Three.js. A dependency Selva uses, not a Selva component.
- **Plugin internals** (`Plugin/Selva.GH`) — components, schema-link WebSocket protocol, embedded HTTP server. Lives in the .NET workspace; would deserve its own `Plugin/ARCHITECTURE.md`.
- **Frontend component architecture** — Svelte stores, theming, the `@selvajs/shared` library. Tracked in `packages/compute-app/UI_INVENTORY.md`.
