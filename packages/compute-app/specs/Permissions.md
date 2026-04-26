# Access Control — Selva

The single source of truth for who can do what. Authored ahead of implementation; the code conforms to this doc, not the other way around.

---

## 1. Mental model

Three scopes of authority, from broadest to narrowest:

| Scope        | Who it applies to              | What it answers                                         |
| ------------ | ------------------------------ | ------------------------------------------------------- |
| **Platform** | The entire Selva instance      | "Can you administer the instance itself?"               |
| **Org**      | A single organization (tenant) | "Which tenant's data can you touch, and how much?"      |
| **Project**  | A single project inside an org | "In this project, are you a contributor or a consumer?" |

**Org is the hard tenancy boundary.** No resource crosses org lines except explicit `public` projects (see §4).

A user can belong to multiple orgs. Their permissions in one org are independent of another — Alice can be `admin` in Acme and `member` in BigClient.

Every incoming request carries an **acting org context** (`RequestContext.actingOrgId`). Tenancy checks compare `ctx.actingOrgId` to the resource's `orgId` — never "is the user a member of some org that matches." This prevents subtle cross-org leaks when a user belongs to multiple orgs.

---

## 2. Platform scope

One role, four permissions. All instance-wide.

| Permission              | What it grants                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `instance_admin`        | Superuser. Implies every other permission, everywhere.                                                  |
| `manage_compute`        | Configure the instance-wide Rhino.Compute pool (default + named servers). See §3 for per-org overrides. |
| `manage_instance_users` | Disable/enable any user on the instance.                                                                |
| `manage_updates`        | Run system updates.                                                                                     |

> **Renamed from `platform_admin`** — "instance" is concrete (this deployment), "platform" was ambiguous.
>
> **`manage_users` renamed to `manage_instance_users`** — symmetric with org-scope `manage_org_members`, no collision possible.

**Invariant: at least one user holds `instance_admin`.** Any operation that would leave the instance with zero `instance_admin`s — revoking the permission, deleting the user, disabling the user — is rejected by the data layer (`IPlatformPermissionStore`). Revocation is blocked inside `set()`; delete/disable is blocked by the route handler consulting `countInstanceAdminsExcluding(targetId)` before calling the auth provider. Mirrored in the admin UI by disabling the relevant control on the sole admin. See §10 for the offboarding pattern.

**Break-glass recovery.** If the invariant is ever bypassed by non-runtime means (manual DB edits, restoring from a backup pre-dating the invariant, migration drift), set `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` and have the named user sign in via OAuth. The callback grants every platform permission iff no admin exists *and* the signing-in email matches. The env var also functions as a production hardening — without it, any user can win the bootstrap race on a fresh install; with it, only the configured operator can. Local provider has no equivalent path because admin can be edited directly in `users.json`.

**Deployment modes:**

- **Self-hosted / single-tenant.** One org exists, provisioned at install time. The `instance_admin` is typically also the org owner. UI merges the two views.
- **Multi-tenant (future).** Many orgs coexist. `instance_admin` is Selva-staff-only. Config flag `ALLOW_ORG_CREATION=true` lets authenticated users create their own orgs.

---

## 3. Org scope

### Roles

| Role     | Default permissions                                                      |
| -------- | ------------------------------------------------------------------------ |
| `owner`  | All four org permissions. Cannot be demoted by anyone but self-transfer. |
| `admin`  | All four org permissions.                                                |
| `member` | None by default. Grantable: `manage_definitions`, `manage_projects`.     |

### Permissions

| Permission           | What it grants                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manage_org_members` | Invite, remove, change roles of users in **this** org. Owner/admin only — never grantable to `member`.                                                                                                                     |
| `manage_definitions` | Upload/edit definitions in this org (further gated by project role).                                                                                                                                                       |
| `manage_projects`    | Create projects in this org. (Editing/deleting gated by project role.)                                                                                                                                                     |
| `manage_org_compute` | Configure this org's compute server override (BYO compute). Owner/admin only. **Gated by platform flag `ALLOW_ORG_COMPUTE_OVERRIDE`**; when off, this permission is effectively inert and all solves use the instance pool. |

> **`manage_compute` stays at platform scope.** Instance-wide compute is the platform admin's concern. `manage_org_compute` is a separate, org-scoped permission that only grants authority over the org's _override_, never the instance pool.

### Invites

- **Org-scoped only.** You invite a user to an org, not to a project.
- Once in an org, project membership is managed within-org (see §5).
- Cross-org project guests are **out of scope for now.** Deferred (see §12).

### Compute (BYO override)

Each instance has a default compute pool configured by `instance_admin` (§2). Orgs can optionally override with their own Rhino.Compute server:

- **Default:** no override → the org's solves use the instance pool.
- **Override:** org `owner`/`admin` with `manage_org_compute` configures a custom Rhino.Compute URL + key → the org's solves route there instead.
- **Platform gate:** overrides only work when `ALLOW_ORG_COMPUTE_OVERRIDE=true` at the platform level. Self-hosted single-tenant and early SaaS can leave this off — everyone shares the one pool.

**Resolution order** (pure function, no I/O), narrowest wins:

1. If the definition has `computeServerId` set → use that server. Lets a single heavy definition route to beefier hardware while light ones stay on cheap servers.
2. Else, if the project's org has a compute override **and** the platform flag is on → use the override.
3. Otherwise → use the instance default pool.

The override is never instance-wide. An org misconfiguring their compute (wrong URL, bad key) only affects that org's solves. The instance pool is the `instance_admin`'s domain and cannot be touched by org admins under any circumstance.

`ComputeServerConfig` carries an optional `orgId` field: null rows are instance-pool servers, non-null rows are that org's override. `Definition.computeServerId` is an optional per-definition pin to one of those rows. Stores filter by scope on read; the `resolveComputeServerForOrg(instance, org, opts)` helper applies the precedence rule with the platform flag.

---

## 4. Project scope

### Roles

| Role     | Can view/solve | Can edit definitions | Can manage project |
| -------- | :------------: | :------------------: | :----------------: |
| `owner`  |       ✅       |          ✅          |         ✅         |
| `editor` |       ✅       |          ✅          |         ❌         |
| `viewer` |       ✅       |          ❌          |         ❌         |

`viewer` exists specifically for clients / stakeholders / auditors: they see schemas, submit solves, download results — but cannot modify the definition.

### Visibility

| Visibility | Who can view/solve                                        |
| ---------- | --------------------------------------------------------- |
| `private`  | Project members only (explicit owner/editor/viewer role). |
| `org`      | Any member of the parent org.                             |
| `public`   | Any authenticated user on the instance. Cross-org.        |

**Default for new projects: `private`.** Users opt into broader visibility explicitly.

**Anonymous access is not a project flag** — it's delivered via per-definition **share links** (§7). The project owner mints a link for one definition + channel; the link carries its own cap, expiry, and revocation. There is no "this project is anonymously solvable" mode; explicit per-link grants only.

### Project members must be org members

To become a project member, a user must first be a member of the project's parent org. This is enforced in the **rule layer**, not as a hard DB constraint — leaving room for cross-org identities (guests, service accounts) later without a schema migration.

### Optional per-project flags

| Flag               | Default | Meaning                                                                                        |
| ------------------ | :-----: | ---------------------------------------------------------------------------------------------- |
| `autoJoinOnUpload` | `false` | Enables the **commons model** on this project (see below). Only settable on `public` projects. |

### The two project models

Selva supports two distinct authority models, selected per-project by `autoJoinOnUpload`:

**Project-as-container model** (`autoJoinOnUpload=false`, the default) — enterprise/internal projects.

- Project role is authoritative. Only explicit project `owner`/`editor` can upload or edit anything.
- Definition "ownership" is display metadata only, not access logic.
- The project owner controls every definition in the project.
- Use for: company workflows, client deliverables, internal tools.

**Project-as-commons model** (`autoJoinOnUpload=true`) — user-generated content, commons publishing.

- **Anyone authenticated can upload a new definition.** They become the _definition owner_ (not a project member).
- **Definition owners can edit/delete their own definitions.** They cannot touch anyone else's.
- Project `owner`/`editor` can still edit anyone's definition (moderation).
- No auto-grant of project `editor` role. The flag enables the per-definition ownership gate, nothing else.
- Use for: instance-wide "Shared Scripts" common, community libraries, user-contributed galleries.

The distinction protects the Alice/Peter case: on a commons project, Peter cannot upload a new version of Alice's definition (he isn't its owner and isn't a project editor). Peter can upload _his own_ new definition and edit _that_. Alice's work stays Alice's.

**The project model is chosen at creation time** and changing it later is a deliberate decision — flipping `autoJoinOnUpload` from false → true on a project with existing definitions grants the commons contract to _new_ definitions only; existing ones remain under project-role control with their `createdBy` user treated as the definition owner retroactively.

---

## 5. Rules

The pure access-control functions live in [rules.ts](../../platform/src/access/rules.ts). They take already-resolved entities as input and return booleans. Adapters do the lookup; rules do the logic.

> **Single source of truth.** Every gate — adapter `can*` methods, route-layer `requireCan*` helpers — funnels through `rules.ts`. No predicate is duplicated; the route layer pre-loads the membership rows the rule needs and calls it directly. Cross-org-public visibility short-circuits the fetch so the hot path stays cheap.

### The `instance_admin` bypass lives in one place

Rather than every rule starting with `if (instance_admin) return true`, the bypass is centralized in a single wrapper applied at the rule-call site (in [access.server.ts](../src/lib/server/access.server.ts) or the adapter layer). The pure rules below reason about **normal users only.**

This matters for two reasons: (1) a bug in a rule doesn't become a bug in god-mode, and (2) the wrapper is the future hook point for audit logging instance-admin access to foreign org data. Today the hook is a no-op; when audit ships, every cross-tenant admin access records automatically without touching rule bodies.

### Share-link grants are a parallel path

A request authenticated by a valid share-link token (§7) is granted access to **one specific (definitionId, channel) pair only**, regardless of project visibility or membership. Token validation runs **before** the user-based rules below in the request pipeline; if a valid token resolves, those rules are skipped for that request. See §7 for the token contract.

### `canView(project, user, ctx) → bool`

- `private` → yes iff user is a project member (any role)
- `org` → yes iff `ctx.actingOrgId === project.orgId` **and** user is a member of that org
- `public` → yes iff user is authenticated on the instance, **and** either `ALLOW_CROSS_ORG_PUBLIC=true` OR the user is a member of the project's parent org. With the flag off, `public` narrows to "everyone in the publishing org" — the visibility flip is still allowed (see `canChangeVisibilityToPublic`), but the reach is the org rather than the instance.

### `canSolve(project, user, ctx) → bool`

A distinct function from `canView`. **Today its body is `canView(...)`** — if you can see it, you can solve it.

It exists as a separate function so future solve-gating (cost quotas, rate limits, compute-budget checks) has an obvious home without touching every call site or retrofitting `canView` semantics. Authorization and cost are two different concerns; keeping the functions distinct keeps them from tangling.

### `canEdit(project, user) → bool` — project-level edit gate

- Project `owner` or `editor` → yes
- Otherwise → no

The generic "can this user touch project-scoped resources" predicate. Used where the gate is project-level and definition ownership doesn't apply: filtering the project list to ones the caller can edit, gating new-definition uploads on container projects (commons projects skip this and use the §4 commons contract), and as the building block for `requireCanEdit` in the access layer. Distinct from `canEditDefinition` (which adds the commons-mode definition-owner branch) and `canEditProjectSettings` (owner-only).

### `canEditDefinition(project, definition, user) → bool`

- Project `owner` or `editor` → **yes** (always — moderation authority)
- Project has `autoJoinOnUpload=true` **and** `user.id === definition.ownerId` → **yes** (commons: you own what you uploaded)
- Otherwise → no

> **Takes the definition as input**, not just the project. The commons model needs to know _which_ definition is being edited because ownership is per-definition. In the container model (`autoJoinOnUpload=false`) the definition parameter isn't consulted — project role decides.
>
> **No mutation inside the rule.** The rule is a pure boolean. On a commons project, uploading a _new_ definition (not a new version of an existing one) creates the `Definition` record with `ownerId = uploader.id` — that's a handler responsibility, not a rule concern. The uploader does not become a project member; they are the definition's owner, which is a separate concept.

### Upload route semantics

Upload behavior depends on whether the request is creating a _new definition_ or a _new version of an existing one_:

- **New definition** (`POST /api/definitions`): on container projects, requires `canEditDefinition` to pass preemptively — in practice means project `owner`/`editor`. On commons projects, any authenticated user on the instance may create a new definition; `ownerId` is set to the uploader.
- **New version of existing definition** (`POST /api/definitions/[guid]`): requires `canEditDefinition(project, definition, user)` to pass. In container mode, that means project `owner`/`editor`. In commons mode, that means the same OR the definition owner. Random users cannot version-bump someone else's definition.

### `canEditProjectSettings(project, user) → bool`

- Project `owner` → yes
- Otherwise → no

> **Simplified.** An earlier draft allowed `editor + manage_projects` org-permission to edit settings. That violated §13's no-inheritance rule (org permission leaks into project authority) and created non-local confusion ("why can this editor edit settings but that one can't?"). Collapsed to **owner only**. If an editor needs settings authority, promote them to owner. Org-side escape hatches exist via `canReclaim`.

### `canChangeVisibilityToPublic(project, user) → bool`

Flipping a project **to** `public` is a disclosure action and requires stricter perms than normal editing:

- Org `owner` or `admin` → yes
- Otherwise → no

The `ALLOW_CROSS_ORG_PUBLIC` platform flag does **not** gate this rule — it only changes what `public` means post-flip. With the flag on, `public` reaches any authenticated user on the instance (cross-org). With the flag off, `public` narrows to members of the publishing org (within-org). That semantic switch is enforced by `canView`, not here. Self-hosted single-tenant instances can leave the flag off — the flip still works; the reach matches their tenancy model.

### `canManage(project, user) → bool` — delete project, manage members

- Project `owner` → yes
- Otherwise → no

**Owner-on-owner removal requires explicit confirmation.** When a project has multiple owners (e.g., after a reclaim), one owner can remove another, but the handler surfaces a confirm step via `checkOwnerRemoval` (below) to prevent accidental lockouts.

### `checkOwnerRemoval(target, allMembers, confirmed) → 'ok' | 'sole_owner' | 'needs_confirm'`

Pre-flight check the route handler runs after `canManage` has authorized the actor. Pure function over already-loaded membership rows so behavior is identical across providers.

- Target is non-owner → `'ok'` (canManage already authorized)
- Target is the sole owner → `'sole_owner'` (route returns 409; suggests reclaim)
- Owner-on-owner removal without `?confirm=true` → `'needs_confirm'` (route returns 409; client retries with confirmation)
- Owner-on-owner with `?confirm=true` and ≥2 owners remain after → `'ok'`

The route handler at `/api/projects/[id]/members/[userId]` `DELETE` consults this and translates the result to the appropriate HTTP response.

### `canReclaim(project, user, ctx) → bool` — org owner/admin escape hatch

Org leadership can reclaim any project in their org to regain access (e.g., original owner left the company):

- `ctx.actingOrgId === project.orgId` **and** user is org `owner` or `admin` → yes
- Otherwise → no

**Reclaim adds the actor as a co-owner.** It does **not** demote the existing owner. This preserves the original owner's access if they return and provides an audit trail of the escalation.

### `canCreateProject(org, user, ctx) → bool`

- `ctx.actingOrgId === org.id` **and** user is org `owner` or `admin` → yes
- `ctx.actingOrgId === org.id` **and** user is org `member` with `manage_projects` → yes
- Otherwise → no

The creating user automatically becomes project `owner`.

---

## 6. Definition versioning

Every definition has **immutable versions** and **named channels** pointing at versions.

### Data model

- `DefinitionVersion { id, definitionId, versionNumber, fileExt, fileKey, originalFilename?, uploadedBy, uploadedAt }`
- `Definition.liveVersionId` — the published version (what external consumers solve)
- `Definition.draftVersionId` — the latest upload (what editors test against)

`fileExt` and `originalFilename` live on the version, not the parent record — different versions of the same definition can carry different uploaded filenames or extensions.

### Channels

| Channel | Points to        | Who can solve it                              |
| ------- | ---------------- | --------------------------------------------- |
| `live`  | `liveVersionId`  | Anyone who passes `canSolve` for the project. |
| `draft` | `draftVersionId` | Project `owner` / `editor` only.              |

### Flow

1. Alice uploads `scheme.gh` → `v1` created. Both channels point to `v1`.
2. Alice re-uploads → `v2` created. `draft` advances to `v2`. **`live` stays on `v1`.**
3. Alice tests `v2` via `/app?gh=scheme&channel=draft`. Works.
4. Alice clicks **Publish** → `live` advances to `v2`.

### Rollback

`live` can be reassigned to **any prior version** at any time. Rollback is a first-class operation, not a re-upload — it just re-points the `liveVersionId` at a previous `DefinitionVersion`. Required for "we shipped something broken, revert now" scenarios.

### Deletion protection

Versions are immutable. A `DefinitionVersion` **cannot be deleted** while referenced by `liveVersionId` or `draftVersionId`. This protection is enforced at the data layer — the foreign keys (`ON DELETE RESTRICT` in Postgres; explicit check in the local provider) prevent orphaning even if a buggy handler tries.

### Why

- Embedded consumers never break from an upstream edit.
- `draft` and `live` are first-class channels, not hacked through naming.
- Rollback is trivial.
- No UI ceremony required for basic use — upload + publish is one action.

Versioning applies to **all** definitions regardless of project visibility. One model everywhere.

---

## 7. Share links

Per-definition tokens that grant access to one definition + channel **without requiring an account**. Replaces both "share-by-link" and "anonymous-embed abuse controls" — one mechanism, both use cases (sharing a draft for review; embedding a definition in a public iframe).

### Why this shape

- **Definition-scoped, not project-scoped.** Tokens pin to a specific `(definitionId, channel)` pair. A leaked link exposes one definition; new definitions added to the project later are NOT auto-included.
- **Parallel grant system.** Tokens never mutate `Project.visibility` or membership. They are a separate, narrower path — a private project can have share links, and a public project can choose not to.
- **Explicit opt-in per link.** No project-wide "anonymous mode" flag. Every link is minted individually by someone who can edit the definition. Revocation is per-link.
- **Token leakage is the design assumption**, not a failure mode. Anyone viewing an iframe sees the token. So per-link caps and revocation are the load-bearing protections — not "keep tokens secret."

### Data model

```
ShareLink {
  id: string                    PK
  definitionId: string          FK definitions(guid), ON DELETE CASCADE
  channel: 'live' | 'draft'
  tokenHash: string             HMAC of the raw token; raw shown once at mint
  name?: string                 Optional label, UX only
  createdBy: string
  createdAt: ISO
  expiresAt?: ISO               null = no expiry
  revokedAt?: ISO               soft-delete; resolution checks IS NULL
  allowSolve: boolean           false = view-only (schema fetch); true = solve
  maxSolves?: number            null = unlimited (manager opt-in)
  solveCount: number            atomic increment on each successful solve
}
```

### Authorization to mint

A user can mint a share link for a definition iff `canEditDefinition(project, definition, user)` passes. Container-mode editors and commons-mode definition owners both qualify — same rule that gates uploads. Same authority revokes.

### Default cap

Tokens are issued with a default `maxSolves` cap on creation. The minter may raise or remove the cap explicitly with an additional confirm step. The default exists because the design assumes leakage; an uncapped token in an iframe with no expiry is a denial-of-wallet vector.

### Token resolution

When a request to a definition-scoped route (`/api/compute/solve`, `/app/[guid]`, schema fetch) carries `?token=…` (or `Authorization: Bearer …`):

1. HMAC the supplied token; look up `tokenHash`.
2. Token must exist; `revokedAt IS NULL`; `expiresAt IS NULL OR expiresAt > now()`; parent definition must itself be live (`deletedAt IS NULL`).
3. Token's `definitionId` must equal the requested definition; token's `channel` must equal the requested channel. Both strict equality.
4. For solve routes, token must have `allowSolve = true`.
5. Build a synthetic `RequestContext` scoped to the token: no user identity, tenancy = the project's `orgId`, no platform/org permissions.
6. Skip `canSolve` / `canView`. Authorization is the token.
7. On a solve, atomically check-and-increment `solveCount`. The cap is enforced **here**, not at resolution: a check at resolution would race with concurrent solves. Postgres: `UPDATE … SET solve_count = solve_count + 1 WHERE solve_count < max_solves OR max_solves IS NULL RETURNING …` — single statement, returns nothing if cap is hit (route surfaces 429). Local: read-modify-write; race acceptable at single-node scale.

If any check fails, the route falls through to the existing user-based auth. A request without a valid token AND without a user session ends with 401 as today.

### Cascade

- Definition soft-deleted → tokens fail closed at resolution (`def.deletedAt IS NULL` check).
- Definition hard-deleted → tokens cascade-delete via FK.
- Project deleted → cascades through definition.
- Token creator's user account deleted → tokens unaffected. The link works as long as the parent definition allows it. (Intentional: share links shouldn't break when a contributor leaves the org.)

### What's NOT in v1

- **JWT.** Random opaque tokens + DB lookup is sufficient. JWT only helps stateless validation, but every check hits the DB anyway (revocation, counter).
- **Per-version pinning.** Tokens follow the channel pointer. Publishing v3 means existing live tokens now serve v3 — same semantics as rollback. Add a `versionId` field then if "always serve v2 specifically" becomes a real need.
- **Origin / Referer allowlist.** Easy to bypass server-side; gives a false sense of security. Caps and revocation are the load-bearing protections.
- **Project-scoped tokens.** Granularity is one definition, not a project bundle. If a customer wants to share five, they mint five — explicit and revocable separately.

---

## 8. API route matrix

Authoritative mapping of HTTP routes to rule checks. `instance_admin` passes every row (via the centralized bypass, §5).

### Content API (`/api/*`)

| Route                                                | Method     | Rule                                                                                                                                                                                          |
| ---------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/projects`                                      | `GET`      | Authenticated. Filtered by visibility + membership.                                                                                                                                           |
| `/api/projects`                                      | `POST`     | `canCreateProject(targetOrg, user, ctx)`                                                                                                                                                      |
| `/api/projects/[id]`                                 | `GET`      | `canView(project, user, ctx)`                                                                                                                                                                 |
| `/api/projects/[id]`                                 | `PATCH`    | `canEditProjectSettings`. Visibility → `public` additionally requires `canChangeVisibilityToPublic`.                                                                                          |
| `/api/projects/[id]`                                 | `DELETE`   | `canManage(project, user)`                                                                                                                                                                    |
| `/api/projects/[id]/reclaim`                         | `POST`     | `canReclaim(project, user, ctx)`                                                                                                                                                              |
| `/api/projects/[id]/members`                         | `GET/POST` | `canManage(project, user)`. Target user must be org member (rule layer).                                                                                                                      |
| `/api/projects/[id]/members/[userId]`                | `PATCH`    | `canManage(project, user)`                                                                                                                                                                    |
| `/api/projects/[id]/members/[userId]`                | `DELETE`   | `canManage(project, user)`. Sole-owner removal blocked. Owner-on-owner removal requires `?confirm=true`.                                                                                      |
| `/api/definitions`                                   | `POST`     | **Create new definition.** Container mode: project `owner`/`editor`. Commons mode (`autoJoinOnUpload=true`): any authenticated user; handler sets `definition.ownerId = user.id`.             |
| `/api/definitions/[guid]`                            | `POST`     | **New version of existing definition.** `canEditDefinition`. Creates a new `DefinitionVersion`; advances `draft`.                                                                             |
| `/api/definitions/[guid]`                            | `PUT`      | `canEditDefinition` (metadata only).                                                                                                                                                          |
| `/api/definitions/[guid]`                            | `DELETE`   | `canEditDefinition`                                                                                                                                                                           |
| `/api/definitions/[guid]/image`                      | `POST`     | `canEditDefinition`                                                                                                                                                                           |
| `/api/definitions/[guid]/publish`                    | `POST`     | `canEditDefinition`. Body `{ versionId? }`; advances `live` to a target version (current `draft` or any prior version for rollback).                                                          |
| `/api/definitions/[guid]/versions`                   | `GET`      | `canView`                                                                                                                                                                                     |
| `/api/definitions/[guid]/versions/[versionId]`       | `DELETE`   | `canEditDefinition`. §6 deletion protection — 409 if version is referenced by `liveVersionId`/`draftVersionId`.                                                                               |
| `/api/definitions/[guid]/share-links`                | `GET/POST` | `canEditDefinition`. POST returns the raw token once.                                                                                                                                         |
| `/api/definitions/[guid]/share-links/[linkId]`       | `DELETE`   | `canEditDefinition`. Soft-delete (sets `revokedAt`).                                                                                                                                          |
| `/api/compute/solve`                                 | `POST`     | `canSolve(project, user, ctx)`. Channel: `live` (default) or `draft`; `draft` requires `canEditDefinition`. **A valid `?token=…` (§7) bypasses user auth and grants the token's pinned scope only.** |
| `/api/compute/schema?projectId=…`                    | `POST`     | `requireCanCreateDefinition(projectId)` — same gate as creating a definition. Container projects need owner/editor; commons projects accept any authenticated user. The target project's `orgId` selects BYO compute. Used by the upload dialog to preview a user-supplied .gh file's schema before saving. |
| `/api/org/compute`                                   | `GET/PUT`  | `manage_org_compute`. Gated by `ALLOW_ORG_COMPUTE_OVERRIDE` platform flag. Tenancy implicit via `ctx.actingOrgId`.                                                                            |
| `/api/invites`                                       | `GET/POST` | `manage_org_members` for the active org.                                                                                                                                                       |
| `/api/invites/[id]`                                  | `DELETE`   | `manage_org_members`.                                                                                                                                                                          |
| `/api/me/starred/[guid]`                             | `POST/DELETE` | Authenticated. Acts on `locals.user.id`'s own profile only — `IUserProfileStore` enforces self-or-admin scoping.                                                                          |
| `/api/files/[...path]`                               | `GET`      | Storage proxy. Public buckets serve unauthenticated; private buckets require an authenticated session whose ctx authorizes the resource the path encodes.                                      |

### Admin API (`/admin/api/*`)

Instance-level only. Denial returns **403** (not redirect).

| Route                              | Method | Permission              |
| ---------------------------------- | ------ | ----------------------- |
| `/admin/api/users`                 | `*`    | `manage_instance_users` |
| `/admin/api/users/[id]`            | `PATCH/DELETE` | `manage_instance_users`. PATCH that changes platform-scope perms additionally requires `instance_admin`. DELETE consults `IPlatformPermissionStore.countInstanceAdminsExcluding` and returns 409 when removing the sole admin. |
| `/admin/api/users/[id]/disable`    | `POST` | `manage_instance_users`. Same sole-admin invariant as DELETE. |
| `/admin/api/compute`               | `*`    | `manage_compute`        |
| `/admin/api/compute/status`        | `GET`  | `manage_compute`        |
| `/admin/api/system/update`         | `POST` | `manage_updates`        |
| `/admin/api/orgs`                  | `*`    | `instance_admin`        |
| `/admin/api/orgs/[id]`             | `*`    | `instance_admin`        |

### Admin pages (`/admin/*`)

Instance-level only. The shell admits **platform** perms exclusively — org-scope perms (`manage_org_members`, `manage_org_compute`, `manage_definitions`, `manage_projects`) never grant entry, even though they share the `manage_*` prefix. Sub-page denial redirects to `/admin`; layout-level denial (no platform perm at all) redirects to `/app`.

| Page                 | Permission              |
| -------------------- | ----------------------- |
| `/admin` (dashboard) | Any platform perm       |
| `/admin/users`       | `manage_instance_users` |
| `/admin/compute`     | `manage_compute`        |
| `/admin/orgs`        | `instance_admin`        |
| `/admin/update`      | `manage_updates`        |

### Auth flow (`/auth/*`)

Public routes — the auth round-trip IS the credential flow, so no permission check applies. Used when `SUPABASE_OAUTH_PROVIDERS` is set.

| Route                          | Method | What it does                                                                                                                                                                                                  |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/supabase/start`         | `GET`  | `?provider=google&redirectTo=/app` — mints an OAuth authorize URL via Supabase and redirects.                                                                                                                 |
| `/auth/supabase/callback`      | `GET`  | `?code=…` — exchanges the code for a session, sets `admin_session` + `admin_refresh` cookies, redirects to `redirectTo`. **First-OAuth-signin-becomes-admin:** if no `instance_admin` exists, the new user is granted every platform permission via `IPlatformPermissionStore.set`. |

---

## 9. Data model invariants

These are the decisions that are **cheap to lock in now, expensive to retrofit later**.

### On every tenant-owned entity

- **`orgId`** — foreign key to the owning org. Never nullable for tenant-owned rows. Enables row-level tenant isolation (RLS when we move to Postgres).

### On every mutable entity

- **`createdBy`** — user id of the creator. Never changes.
- **`updatedBy`** — user id of the last mutator.
- **`createdAt`** — ISO 8601.
- **`updatedAt`** — ISO 8601.
- **`deletedAt`** — ISO 8601, nullable. Soft delete.

### Soft delete is enforced at the data-access layer

Reads filter `deletedAt IS NULL` at the **repository / view / RLS layer**, never at individual application call sites. Application code should not be able to accidentally read a soft-deleted row — one missed filter in a route handler is a data leak. Enforce in the data layer (filtered repository methods, or DB views / RLS policies once on Postgres), so there's nothing to forget.

Hard deletion is a background / admin-only operation that removes rows with `deletedAt` older than a retention window.

### Request context

- `RequestContext.user` is an **identity**, not specifically a human. A service account, anonymous visitor, or share-token-resolved synthetic identity slots in without changing rule signatures.
- `RequestContext.actingOrgId` identifies which org the user is acting as. The field is **optional in the type** (undefined for instance-admin global reads and pre-org routes), but **required at every route handler that touches tenant-owned data** — those handlers reject with 400 when it's missing. Prevents cross-org leaks when a user belongs to multiple orgs.
- User IDs referenced on entities (e.g., `createdBy`) may become unresolvable over time (account deletion). UI renders as "Deleted user"; entities are not orphaned.

### Project membership schema

- `ProjectMember.userId` references an identity, not an `OrgMember`. The "members must be org members" rule (§4) is enforced in the rule layer, not as a DB check constraint. This keeps room for cross-org guests and service accounts later without a schema migration.

### Definition ownership

- `Definition.ownerId` is **not nullable** and is set to the uploader at creation time. It never changes.
- In the container model (`autoJoinOnUpload=false`) it is display metadata only. In the commons model (`autoJoinOnUpload=true`) it is an access-control input — only the owner or project editors can edit/delete a commons definition.
- If the owner's account is deleted, `ownerId` points at an unresolvable id; UI renders "Deleted user" and the definition effectively becomes editable only by project editors (moderation path).

### Events (future-proofing)

Every successful mutation emits an internal domain event (`project.created`, `definition.published`, `member.removed`, `share_link.minted`, `share_link.revoked`, …). The Supabase deployment wires `SupabaseEventSink`, persisting every event to `public.audit_events` (type, actor, timestamp, full JSONB payload). The local provider stays on `NoopEventSink` — dev mode has no audit requirement. Webhook dispatch and the audit-log viewer UI plug in later as additional `IEventSink` implementations.

---

## 10. Offboarding & ownership transfer

- **Disable user (instance-wide):** `manage_instance_users` sets `disabled=true`. Sessions invalidated; identity and attribution preserved.
- **Remove user from org:** org `owner`/`admin` or `manage_org_members`. User loses all project memberships in that org. Still exists on the instance.
- **Sole-owner projects on offboarding:** removal is **blocked** until a new owner is assigned (manual step). No silent reassignment. If the original owner is unreachable, org `owner`/`admin` uses **Reclaim** (§5 `canReclaim`) to become co-owner first, then proceeds with removal — that's the explicit escape hatch.
- **Sole instance admin:** revoking `instance_admin`, deleting, or disabling the last user holding `instance_admin` is **blocked** at the data layer (`IPlatformPermissionStore`) — the operation returns `last_admin`, which the API surfaces as **409 Conflict** with an actionable message ("Promote another user to instance admin first"). For revocation the store enforces the invariant directly inside `set`. For delete/disable the route handler consults `countInstanceAdminsExcluding(targetUserId)` BEFORE calling the auth provider, since the auth provider only handles identity and doesn't know about Selva-specific permissions. The admin UI mirrors the lock by disabling the relevant control on the sole admin and surfacing the reason. Symmetric with sole-owner project removal above. Non-runtime corruption (manual DB edits, bad migrations, backup restore) is recoverable via `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` (§2).
- **Delete user (hard):** admin-initiated only. Goes through the auth provider. Selva's references resolve to "Deleted user." Share links the user minted are unaffected (they belong to the definition, not the creator).
- **Org ownership transfer:** explicit action by the current org owner. `instance_admin` can force-transfer as a break-glass.

---

## 11. Scenarios (sanity checks)

Walk through these to confirm the model behaves as expected.

| Scenario                                                                                                                      | Outcome                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alice (Acme `admin`) creates a `private` project.                                                                             | Alice is project `owner`. Only project members can view or solve.                                                                                                             |
| Bob (Acme `member`, no project membership) navigates directly to the private project URL.                                     | **403.** Visibility is enforced on solve too.                                                                                                                                 |
| Carol (BigClient `member`) navigates to Acme's `org` project URL.                                                             | **403.** `ctx.actingOrgId` doesn't match Acme's org.                                                                                                                          |
| Bob (Acme `member`, no project membership) views/solves an Acme `org` project.                                                | **OK.** `canView`/`canSolve` pass — org visibility grants view + solve to all org members.                                                                                    |
| Bob (Acme `member`, no project membership) tries to edit the same `org` project's definition.                                 | **403.** `canEditDefinition` requires explicit project `owner`/`editor` role — org membership alone is view + solve, not edit.                                                |
| Dave (authenticated, any org) navigates to a `public` project Alice published.                                                | **OK.** Cross-org public visible to any authenticated user (with platform flag on).                                                                                           |
| Bob uploads a **new** definition to a `public` + `autoJoinOnUpload=true` commons project.                                     | **OK.** Definition created with `ownerId = Bob`. Bob is the definition owner — _not_ a project member. He can edit/delete this one definition; he cannot touch anyone else's. |
| Alice (definition owner on commons) uploads `v2` of her own definition.                                                       | **OK.** `canEditDefinition` passes because Alice is the definition's owner. `draft` = `v2`, `live` = `v1` until she publishes.                                                |
| **Peter (random authenticated user, no project membership) tries to upload `v2` on Alice's definition in a commons project.** | **403.** Peter is not the definition owner and not a project editor. The "anyone can contribute" opt-in does **not** mean "anyone can vandalize existing work."               |
| Peter (random user) uploads his _own_ new definition to the same commons project.                                             | **OK.** New definition, `ownerId = Peter`. Peter can edit his own; Alice's remains untouchable to him.                                                                        |
| Alice (project owner on a commons project) moderates Peter's definition (it's inappropriate).                                 | **OK.** Project owner/editor retains full moderation authority over every definition in the project regardless of commons mode.                                               |
| Alice realizes `v2` is broken. Rolls `live` back to `v1`.                                                                     | `live` re-points to `v1`. `v2` still exists, can be re-published after fixes.                                                                                                 |
| Alice tries to delete `v1` while it's the live version.                                                                       | **409.** §6 deletion protection — repoint `live` first.                                                                                                                       |
| Alice (project `editor`) tries to edit project settings.                                                                      | **403.** Editors cannot edit settings. Promote to owner if needed.                                                                                                            |
| Alice (project `viewer`) tries to delete a definition.                                                                        | **403.** Viewers cannot edit.                                                                                                                                                 |
| Project owner leaves Acme. Org owner opens the project.                                                                       | Uses **Reclaim** → becomes co-owner. Original owner not demoted. Audit entry (future).                                                                                        |
| Reclaim done; co-owner tries to remove the original owner.                                                                    | Handler surfaces owner-on-owner confirm step (`?confirm=true`) before proceeding.                                                                                             |
| Alice flips a `private` project to `public`.                                                                                  | Requires org `owner`/`admin` (Alice qualifies as `admin`). If cross-org public is off at platform level, flip is rejected.                                                    |
| `instance_admin` views Acme data.                                                                                             | **OK.** Centralized bypass wrapper records the access (future audit hook).                                                                                                    |
| Alice mints a `live`-channel share link for her definition with a 1000-solve cap. Bob (no account) solves 999 times via the link; the 1000th request hits 429. | **OK.** Cap enforced by atomic increment. Alice raises the cap, removes it, or revokes. |
| Alice mints a `draft`-channel share link for QA review. The reviewer (no account) opens it and solves the unpublished version. | **OK.** Token grants the pinned channel only. The reviewer cannot switch to `live` from the same token.                                                                       |
| Alice's share link gets posted publicly and starts seeing a flood of solves. Alice clicks **Revoke**.                         | The link 401s on next use. Existing in-flight solves complete; subsequent ones fail at token resolution.                                                                      |
| Alice deletes the definition that a share link points at.                                                                     | Token resolution fails closed (`def.deletedAt IS NULL` check). Hard delete cascades the link out.                                                                             |
| Acme org configures a BYO compute server; instance has `ALLOW_ORG_COMPUTE_OVERRIDE=true`.                                     | Solves on Acme projects route to Acme's compute. Solves on other orgs' projects continue to use the instance pool.                                                            |
| `instance_admin` edits compute config in their personal org context.                                                          | Edits the **instance pool** regardless of `actingOrgId` — the `/admin/api/compute` route explicitly scopes to instance.                                                       |
| Sole `instance_admin` unchecks their own `Instance Admin (all)` checkbox.                                                     | **409.** `IPlatformPermissionStore.set` returns `last_admin`; UI mirror disables the checkbox preemptively. Promote another user first, then demote.                          |
| `instance_admin` deletes the only other user, who also holds `instance_admin`.                                                | Allowed — the actor still holds it. The DELETE handler consults `countInstanceAdminsExcluding(targetId)` first; with the actor still admin, the count is ≥1 and the call proceeds. |
| Sole `instance_admin` tries to delete or disable themselves.                                                                  | **409.** The route handler's `countInstanceAdminsExcluding(self)` returns 0 and surfaces `last_admin` before reaching the auth provider.                                       |

---

## 12. Deferred (tracked, not built)

Designed-for but not implemented. Each can ship later without breaking the model.

- Cross-org guest on a private project
- Personal scope outside any org
- Project transfer between orgs (UI — data model allows it)
- Audit-log viewer UI. Storage **is** wired in v1: `SupabaseEventSink` persists every domain event to `public.audit_events`. What's deferred is the operator-facing UI for browsing it. The `instance_admin` bypass wrapper is also a hook point for recording cross-tenant admin reads — currently a no-op, lit up when the viewer ships.
- API tokens / service accounts / PATs (distinct from share links — share links are for unauthenticated end-users; PATs are for authenticated programmatic access)
- Webhooks (events emit; dispatcher is later — it slots in as another `IEventSink` alongside the audit sink)
- Per-org data residency / storage backends
- Project templates / bulk member operations (pressure valve for flat ACLs at scale)

---

## 13. Change discipline

The two rules to keep this model from rotting:

1. **Permissions are extensible; roles are not.** Roles are named bundles of permissions — adding a role is a schema migration and UX churn. Adding a permission is cheap. When in doubt, add a permission and map it into the existing roles; don't invent a new role.
2. **No permission inheritance.** Each project carries its own ACL. No cascading from folders, orgs, or templates. Org permissions don't leak into project rules (the old `editor + manage_projects → edit settings` rule violated this and was removed).

When in doubt: **flat, explicit, and one concept per scope.**
