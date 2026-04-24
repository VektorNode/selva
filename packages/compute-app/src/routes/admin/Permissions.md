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
| `manage_compute`        | Configure the instance-wide Rhino.Compute pool (default + named servers). See §4 for per-org overrides. |
| `manage_instance_users` | Disable/enable any user on the instance.                                                                |
| `manage_updates`        | Run system updates.                                                                                     |

> **Renamed from `platform_admin`** — "instance" is concrete (this deployment), "platform" was ambiguous.
>
> **`manage_users` renamed to `manage_instance_users`** — symmetric with org-scope `manage_org_members`, no collision possible.

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

| Permission           | What it grants                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manage_org_members` | Invite, remove, change roles of users in **this** org. Owner/admin only — never grantable to `member`.                                                                                                                           |
| `manage_definitions` | Upload/edit definitions in this org (further gated by project role).                                                                                                                                                             |
| `manage_projects`    | Create projects in this org. (Editing/deleting gated by project role.)                                                                                                                                                           |
| `manage_org_compute` | Configure this org's compute server override (BYO compute). Owner/admin only. **Gated by platform flag `ALLOW_ORG_COMPUTE_OVERRIDE`**; when off, this permission is effectively inert and all solves use the instance pool (§4). |

> **`manage_compute` stays at platform scope.** Instance-wide compute is the platform admin's concern. `manage_org_compute` is a separate, org-scoped permission that only grants authority over the org's _override_, never the instance pool.

### Invites

- **Org-scoped only.** You invite a user to an org, not to a project.
- Once in an org, project membership is managed within-org (see §5).
- Cross-org project guests are **out of scope for now.** Deferred (see §11).

### Compute (BYO override)

Each instance has a default compute pool configured by `instance_admin` (§2). Orgs can optionally override with their own Rhino.Compute server:

- **Default:** no override → the org's solves use the instance pool.
- **Override:** org `owner`/`admin` with `manage_org_compute` configures a custom Rhino.Compute URL + key → the org's solves route there instead.
- **Platform gate:** overrides only work when `ALLOW_ORG_COMPUTE_OVERRIDE=true` at the platform level. Self-hosted single-tenant and early SaaS can leave this off — everyone shares the one pool.

**Resolution order** (pure function, no I/O):

1. If the project's org has a compute override **and** the platform flag is on → use the override.
2. Otherwise → use the instance default pool.

The override is never instance-wide. An org misconfiguring their compute (wrong URL, bad key) only affects that org's solves. The instance pool is the `instance_admin`'s domain and cannot be touched by org admins under any circumstance.

Today `ComputeServerConfig` ([computeServer/types.ts](../../../../../platform/src/computeServer/types.ts)) describes one instance-wide pool of named servers. BYO compute adds an optional `orgId` field: null rows are instance-pool servers, non-null rows are that org's override. `resolveComputeServer()` extends to "org-scoped servers first, fall through to instance pool." Additive migration, no schema break.

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

### Project members must be org members

To become a project member, a user must first be a member of the project's parent org. This is enforced in the **rule layer**, not as a hard DB constraint — leaving room for cross-org identities (guests, service accounts) later without a schema migration.

### Optional per-project flags

| Flag               | Default | Meaning                                                                                        |
| ------------------ | :-----: | ---------------------------------------------------------------------------------------------- |
| `autoJoinOnUpload` | `false` | Enables the **commons model** on this project (see below). Only settable on `public` projects. |
| `allowAnonymous`   | `false` | Unauthenticated visitors can view/solve. Only meaningful for `public` projects.                |

`allowAnonymous` powers iframe embeds on third-party sites. Before it can be flipped on in production, the instance must ship **at least one** abuse control from this set: per-project solve quota, embedding-domain allowlist, or signed embed tokens. Without these, `allowAnonymous=true` is a denial-of-wallet vector — a high-traffic embed or deliberate drain attack lands directly on the publishing org's compute bill. The flag can exist as a schema field today; the toggle gates behind abuse controls shipping.

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

The pure access-control functions live in [rules.ts](../../../../../platform/src/access/rules.ts). They take already-resolved entities as input and return booleans. Adapters do the lookup; rules do the logic.

### The `instance_admin` bypass lives in one place

Rather than every rule starting with `if (instance_admin) return true`, the bypass is centralized in a single wrapper applied at the rule-call site (in [access.server.ts](../../lib/server/access.server.ts) or the adapter layer). The pure rules below reason about **normal users only.**

This matters for two reasons: (1) a bug in a rule doesn't become a bug in god-mode, and (2) the wrapper is the future hook point for audit logging instance-admin access to foreign org data. Today the hook is a no-op; when audit ships, every cross-tenant admin access records automatically without touching rule bodies.

### `canView(project, user, ctx) → bool`

- `private` → yes iff user is a project member (any role)
- `org` → yes iff `ctx.actingOrgId === project.orgId` **and** user is a member of that org
- `public` → yes iff user is authenticated on the instance
- `public` + `allowAnonymous=true` → yes even if user is anonymous

### `canSolve(project, user, ctx) → bool`

A distinct function from `canView`. **Today its body is `canView(...)`** — if you can see it, you can solve it.

It exists as a separate function so future solve-gating (cost quotas, rate limits, compute-budget checks) has an obvious home without touching every call site or retrofitting `canView` semantics. Authorization and cost are two different concerns; keeping the functions distinct keeps them from tangling.

### `canEditDefinition(project, definition, user) → bool`

- Project `owner` or `editor` → **yes** (always — moderation authority)
- Project has `autoJoinOnUpload=true` **and** `user.id === definition.ownerId` → **yes** (commons: you own what you uploaded)
- Otherwise → no

> **Takes the definition as input**, not just the project. The commons model needs to know _which_ definition is being edited because ownership is per-definition. In the container model (`autoJoinOnUpload=false`) the definition parameter isn't consulted — project role decides.
>
> **No mutation inside the rule.** The rule is a pure boolean. On a commons project, uploading a _new_ definition (not a new version of an existing one) creates the `Definition` record with `ownerId = uploader.id` — that's a handler responsibility, not a rule concern. The uploader does not become a project member; they are the definition's owner, which is a separate concept.

### Upload route semantics

Upload behavior depends on whether the request is creating a _new definition_ or a _new version of an existing one_:

- **New definition** (no `guid` in path): on container projects, requires `canEditDefinition` to pass preemptively — in practice means project `owner`/`editor`. On commons projects, any authenticated user on the instance may create a new definition; `ownerId` is set to the uploader.
- **New version of existing definition** (`guid` in path → `POST /api/definitions/[guid]`): requires `canEditDefinition(project, definition, user)` to pass. In container mode, that means project `owner`/`editor`. In commons mode, that means the same OR the definition owner. Random users cannot version-bump someone else's definition.

### `canEditProjectSettings(project, user) → bool`

- Project `owner` → yes
- Otherwise → no

> **Simplified.** An earlier draft allowed `editor + manage_projects` org-permission to edit settings. That violated §12's no-inheritance rule (org permission leaks into project authority) and created non-local confusion ("why can this editor edit settings but that one can't?"). Collapsed to **owner only**. If an editor needs settings authority, promote them to owner. Org-side escape hatches exist via `canReclaim`.

### `canChangeVisibilityToPublic(project, user) → bool`

Flipping a project **to** `public` is a disclosure action and requires stricter perms than normal editing:

- Org `owner` or `admin` → yes
- Otherwise → no

Additionally, cross-org public publishing requires a platform-level opt-in (`ALLOW_CROSS_ORG_PUBLIC=true`). Self-hosted single-tenant instances can leave this off — `public` then means "everyone in the one org."

### `canManage(project, user) → bool` — delete project, manage members

- Project `owner` → yes
- Otherwise → no

**Owner-on-owner removal requires explicit confirmation.** When a project has multiple owners (e.g., after a reclaim), one owner can remove another, but the handler surfaces a confirm step to prevent accidental lockouts.

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

- `DefinitionVersion { id, definitionId, versionNumber, fileKey, uploadedBy, uploadedAt }`
- `Definition.liveVersionId` — the published version (what external consumers solve)
- `Definition.draftVersionId` — the latest upload (what editors test against)

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

Versions are immutable. A `DefinitionVersion` **cannot be deleted** while referenced by `liveVersionId` or `draftVersionId`. This protection is enforced at the data layer, not just in application code — the foreign keys prevent orphaning even if a buggy handler tries.

### Why

- Embedded consumers never break from an upstream edit.
- "In review" and "live" are first-class, not hacked through naming.
- Rollback is trivial.
- No UI ceremony required for basic use — upload + publish is one action.

Versioning applies to **all** definitions regardless of project visibility. One model everywhere.

---

## 7. API route matrix

Authoritative mapping of HTTP routes to rule checks. `instance_admin` passes every row (via the centralized bypass, §5).

### Content API (`/api/*`)

| Route                                 | Method     | Rule                                                                                                                                                                                       |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/projects`                       | `GET`      | Authenticated. Filtered by visibility + membership.                                                                                                                                        |
| `/api/projects`                       | `POST`     | `canCreateProject(targetOrg, user, ctx)`                                                                                                                                                   |
| `/api/projects/[id]`                  | `GET`      | `canView(project, user, ctx)`                                                                                                                                                              |
| `/api/projects/[id]`                  | `PATCH`    | `canEditProjectSettings`. Visibility → `public` additionally requires `canChangeVisibilityToPublic`.                                                                                       |
| `/api/projects/[id]`                  | `DELETE`   | `canManage(project, user)`                                                                                                                                                                 |
| `/api/projects/[id]/reclaim`          | `POST`     | `canReclaim(project, user, ctx)`                                                                                                                                                           |
| `/api/projects/[id]/members`          | `GET/POST` | `canManage(project, user)`. Target user must be org member (rule layer).                                                                                                                   |
| `/api/projects/[id]/members/[userId]` | `PATCH`    | `canManage(project, user)`                                                                                                                                                                 |
| `/api/projects/[id]/members/[userId]` | `DELETE`   | `canManage(project, user)`. Owner-on-owner removal surfaces a confirm.                                                                                                                     |
| `/api/definitions`                    | `POST`     | **Create new definition.** Container mode: requires project `owner`/`editor`. Commons mode (`autoJoinOnUpload=true`): any authenticated user; handler sets `definition.ownerId = user.id`. |
| `/api/definitions/upload`             | `POST`     | Alias for the above when uploading a fresh `.gh`. Creates `Definition` + initial `DefinitionVersion`.                                                                                      |
| `/api/definitions/[guid]`             | `POST`     | **New version of existing definition.** `canEditDefinition(project, definition, user)`. Creates new `DefinitionVersion`; advances `draft`.                                                 |
| `/api/definitions/[guid]`             | `PUT`      | `canEditDefinition(project, definition, user)`                                                                                                                                             |
| `/api/definitions/[guid]`             | `DELETE`   | `canEditDefinition(project, definition, user)`                                                                                                                                             |
| `/api/definitions/[guid]/image`       | `POST`     | `canEditDefinition(project, definition, user)`                                                                                                                                             |
| `/api/definitions/[guid]/publish`     | `POST`     | `canEditDefinition(project, definition, user)`. Advances `live` to a target version (current `draft` or a prior version for rollback).                                                     |
| `/api/definitions/[guid]/versions`    | `GET`      | `canView`                                                                                                                                                                                  |
| `/api/compute/solve`                  | `POST`     | `canSolve(project, user, ctx)`. Channel defaults to `live`; `draft` requires `canEditDefinition`.                                                                                          |

### Admin API (`/admin/api/*`)

Instance-level only. Denial returns **403** (not redirect).

| Route                       | Method | Permission              |
| --------------------------- | ------ | ----------------------- |
| `/admin/api/users`          | `*`    | `manage_instance_users` |
| `/admin/api/compute`        | `*`    | `manage_compute`        |
| `/admin/api/compute/status` | `GET`  | `manage_compute`        |
| `/admin/api/update`         | `POST` | `manage_updates`        |
| `/admin/api/orgs`           | `*`    | `instance_admin`        |

### Admin pages (`/admin/*`)

Denial redirects to `/admin`.

| Page                 | Permission              |
| -------------------- | ----------------------- |
| `/admin` (dashboard) | Any admin perm          |
| `/admin/users`       | `manage_instance_users` |
| `/admin/compute`     | `manage_compute`        |
| `/admin/orgs`        | `instance_admin`        |
| `/admin/update`      | `manage_updates`        |

---

## 8. Data model invariants

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

- `RequestContext.user` is an **identity**, not specifically a human. A service account or anonymous visitor slots in later without changing rule signatures.
- `RequestContext.actingOrgId` identifies which org the user is acting as. Required on every request that touches tenant-owned data. Prevents cross-org leaks when a user belongs to multiple orgs.
- User IDs referenced on entities (e.g., `createdBy`) may become unresolvable over time (account deletion). UI renders as "Deleted user"; entities are not orphaned.

### Project membership schema

- `ProjectMember.userId` references an identity, not an `OrgMember`. The "members must be org members" rule (§4) is enforced in the rule layer, not as a DB check constraint. This keeps room for cross-org guests and service accounts later without a schema migration.

### Definition ownership

- `Definition.ownerId` is **not nullable** and is set to the uploader at creation time. It never changes.
- In the container model (`autoJoinOnUpload=false`) it is display metadata only. In the commons model (`autoJoinOnUpload=true`) it is an access-control input — only the owner or project editors can edit/delete a commons definition.
- If the owner's account is deleted, `ownerId` points at an unresolvable id; UI renders "Deleted user" and the definition effectively becomes editable only by project editors (moderation path).

### Events (future-proofing)

Every successful mutation emits an internal domain event (`project.created`, `definition.published`, `member.removed`, …). Initially a no-op sink. Later this becomes the webhook dispatcher, audit-log writer, and analytics source. Design in now; cost is trivial.

---

## 9. Offboarding & ownership transfer

- **Disable user (instance-wide):** `manage_instance_users` sets `disabled=true`. Sessions invalidated; identity and attribution preserved.
- **Remove user from org:** org `owner`/`admin` or `manage_org_members`. User loses all project memberships in that org. Still exists on the instance.
- **Sole-owner projects on offboarding:** removal is **blocked** until a new owner is assigned (manual step). No silent reassignment. If the original owner is unreachable, org `owner`/`admin` uses **Reclaim** (§5 `canReclaim`) to become co-owner first, then proceeds with removal — that's the explicit escape hatch.
- **Delete user (hard):** admin-initiated only. Goes through the auth provider. Selva's references resolve to "Deleted user."
- **Org ownership transfer:** explicit action by the current org owner. `instance_admin` can force-transfer as a break-glass.

---

## 10. Scenarios (sanity checks)

Walk through these to confirm the model behaves as expected.

| Scenario                                                                                                                      | Outcome                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alice (Acme `admin`) creates a `private` project.                                                                             | Alice is project `owner`. Only project members can view or solve.                                                                                                             |
| Bob (Acme `member`, no project membership) navigates directly to the private project URL.                                     | **403.** Visibility is enforced on solve too (fix vs. current code).                                                                                                          |
| Carol (BigClient `member`) navigates to Acme's `org` project URL.                                                             | **403.** `ctx.actingOrgId` doesn't match Acme's org.                                                                                                                          |
| Bob (Acme `member`, no project membership) views/solves an Acme `org` project.                                                | **OK.** `canView`/`canSolve` pass — org visibility grants view + solve to all org members.                                                                                    |
| Bob (Acme `member`, no project membership) tries to edit the same `org` project's definition.                                 | **403.** `canEditDefinition` requires explicit project `owner`/`editor` role — org membership alone is view + solve, not edit.                                                |
| Dave (authenticated, any org) navigates to a `public` project Alice published.                                                | **OK.** Cross-org public visible to any authenticated user (with platform flag on).                                                                                           |
| Anonymous visitor hits an iframe embedding a `public` + `allowAnonymous=true` project.                                        | **OK** — but only if abuse controls (quota / domain allowlist / signed tokens) are live.                                                                                      |
| Bob uploads a **new** definition to a `public` + `autoJoinOnUpload=true` commons project.                                     | **OK.** Definition created with `ownerId = Bob`. Bob is the definition owner — _not_ a project member. He can edit/delete this one definition; he cannot touch anyone else's. |
| Alice (definition owner on commons) uploads `v2` of her own definition.                                                       | **OK.** `canEditDefinition` passes because Alice is the definition's owner. `draft` = `v2`, `live` = `v1` until she publishes.                                                |
| **Peter (random authenticated user, no project membership) tries to upload `v2` on Alice's definition in a commons project.** | **403.** Peter is not the definition owner and not a project editor. The "anyone can contribute" opt-in does **not** mean "anyone can vandalize existing work."               |
| Peter (random user) uploads his _own_ new definition to the same commons project.                                             | **OK.** New definition, `ownerId = Peter`. Peter can edit his own; Alice's remains untouchable to him.                                                                        |
| Alice (project owner on a commons project) moderates Peter's definition (it's inappropriate).                                 | **OK.** Project owner/editor retains full moderation authority over every definition in the project regardless of commons mode.                                               |
| Alice realizes `v2` is broken. Rolls `live` back to `v1`.                                                                     | `live` re-points to `v1`. `v2` still exists, can be re-published after fixes.                                                                                                 |
| Alice (project `editor`) tries to edit project settings.                                                                      | **403.** Editors cannot edit settings. Promote to owner if needed.                                                                                                            |
| Alice (project `viewer`) tries to delete a definition.                                                                        | **403.** Viewers cannot edit.                                                                                                                                                 |
| Project owner leaves Acme. Org owner opens the project.                                                                       | Uses **Reclaim** → becomes co-owner. Original owner not demoted. Audit entry (future).                                                                                        |
| Reclaim done; co-owner tries to remove the original owner.                                                                    | Handler surfaces owner-on-owner confirm step before proceeding.                                                                                                               |
| Last Acme member is removed while sole-owning 3 projects.                                                                     | **Blocked.** Reclaim or manual "assign owner" flow runs first.                                                                                                                |
| Alice flips a `private` project to `public`.                                                                                  | Requires org `owner`/`admin` (Alice qualifies as `admin`). If cross-org public is off at platform level, flip is rejected.                                                    |
| `instance_admin` views Acme data.                                                                                             | **OK.** Centralized bypass wrapper records the access (future audit hook).                                                                                                    |

---

## 11. Deferred (tracked, not built)

Designed-for but not implemented. Each can ship later without breaking the model.

- Share-by-link (Figma-style scoped tokens — parallel grant system, does not mutate visibility)
- Cross-org guest on a private project
- Personal scope outside any org
- Project transfer between orgs (UI — data model allows it)
- Full audit log storage & UI (hook points exist in the `instance_admin` bypass wrapper and event sink)
- API tokens / service accounts / PATs
- Webhooks (events emit; dispatcher is later)
- Anonymous-embed abuse controls (per-project solve quotas, embedding-domain allowlist, signed embed tokens) — **gating `allowAnonymous` public release**
- Per-org BYO compute **implementation** — designed in §3 (permission `manage_org_compute`, resolution order, platform flag). Schema additive; UI + `ComputeServerConfig.orgId` field deferred until a customer asks.
- Per-org data residency / storage backends
- Project templates / bulk member operations (pressure valve for flat ACLs at scale)

---

## 12. Change discipline

The three rules to keep this model from rotting:

1. **Permissions are extensible; roles are not.** Roles are named bundles of permissions — adding a role is a schema migration and UX churn. Adding a permission is cheap. When in doubt, add a permission and map it into the existing roles; don't invent a new role.
2. **No permission inheritance.** Each project carries its own ACL. No cascading from folders, orgs, or templates. Org permissions don't leak into project rules (the old `editor + manage_projects → edit settings` rule violated this and was removed).

When in doubt: **flat, explicit, and one concept per scope.**
