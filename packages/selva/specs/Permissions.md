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

| Permission              | What it grants                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instance_admin`        | Superuser. Implies every other permission, everywhere.                                                                                                                |
| `manage_compute`        | Manage platform compute servers: create/edit/delete platform servers, set each server's per-org sharing (`sharedWith`), and set the global `defaultServerId`. See §3. |
| `manage_instance_users` | Disable/enable any user on the instance.                                                                                                                              |
| `manage_updates`        | Run system updates.                                                                                                                                                   |

> **Renamed from `platform_admin`** — "instance" is concrete (this deployment), "platform" was ambiguous.
>
> **`manage_users` renamed to `manage_instance_users`** — symmetric with org-scope `manage_org_members`, no collision possible.

**Invariant: at least one user holds `instance_admin`.** Any operation that would leave the instance with zero `instance_admin`s — revoking the permission, deleting the user, disabling the user — is rejected by the data layer (`IPlatformPermissionStore`). Revocation is blocked inside `set()`; delete/disable is blocked by the route handler consulting `countInstanceAdminsExcluding(targetId)` before calling the auth provider. Mirrored in the admin UI by disabling the relevant control on the sole admin. See §10 for the offboarding pattern.

**Both ends of that invariant are atomic, and have to be.** `set()` takes real row locks (Supabase: `set_platform_permissions`, `for update` on the surviving admins; local: a promise-chain mutex) — a plain `count`-then-`update` let two concurrent demotions each see the other as the survivor and both commit, leaving zero admins. The mirror case at the other end is `claimFirstInstanceAdmin`, which grants only if no admin exists yet and re-checks under a lock: read-then-write there let two people signing in at the same moment on a fresh install both become permanent platform admins. Neither is reachable through the UI in normal use; both are reachable on a multi-instance deployment where requests are genuinely concurrent.

**The revocation check is atomic, and had to be made so.** A plain count-then-write races: two concurrent demotions each see the other admin, both pass, both commit, zero admins. Supabase takes the check and the write into one `selva.set_platform_permissions` RPC that locks the target row and then the surviving admin rows with `for update`; a single statement with an `exists` subquery is **not** enough, because under READ COMMITTED the subquery reads the statement's opening snapshot and every concurrent demotion sees the others as still-live. Local serializes count and write through a mutex on `LocalUserDataStore.updatePermissionsGuarded`, which protects one process — the same boundary its load-once cache already draws. A caller that counts and then calls `set` has reintroduced the race.

**`disabled` admins do not count as live.** The local permission store reads `user-data.json` and cannot see the disabled flag, which lives in the auth provider's own file — so `disableUser` revokes `instance_admin` before setting the flag, which is what keeps the count honest on that provider (Supabase filters `disabled = false` in SQL). Consequence: **re-enabling a user does not restore the grant.** An admin must re-tick it, which is the safer default.

**`instance_admin` does not bypass content access.** The `instance_admin` bypass (§5) applies to management actions only — user administration, org management, compute config, project governance (create, delete, manage members, Reclaim). It does **not** apply to content routes: `canView`, `canSolve`, `canEdit`, and `canEditDefinition` run as-is regardless of platform role. Platform staff who need to read a specific private project must Reclaim it first, creating an explicit audit trail (§5 `canReclaim`).

This is a deliberate compliance decision (least privilege / GDPR / SOC 2): blanket content access for admins enlarges the blast radius of a compromised account, is hard to justify in a data audit, and violates user expectations that private work is private. The API layer enforces this boundary; raw database/filesystem access is a separate physical-security concern outside the application layer.

**Break-glass recovery.** If the invariant is ever bypassed by non-runtime means (manual DB edits, restoring from a backup pre-dating the invariant, migration drift), set `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` and have the named user sign in via OAuth. The callback grants every platform permission iff no admin exists _and_ the signing-in email matches. Local provider has no equivalent path because admin can be edited directly in `users.json`.

**Deployment modes** are selected by `tenancy` in [`selva.config.ts`](../../../selva.config.ts) (`'single' | 'multi'`):

- **Self-hosted / single-tenant** (`tenancy: 'single'`). One org exists, provisioned at install time via `/setup`. The `instance_admin` is typically also the org owner; the UI merges the two views. **Bootstrap path is open by default:** without `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, the first OAuth signer on a fresh install wins the bootstrap race — exactly one of them, even if several arrive at once (`claimFirstInstanceAdmin`, above). Setting the env var hardens the path to a named operator only, and is the right default for anything reachable from the internet: "first signer" is only a safe rule while nobody else knows the URL.
- **Multi-tenant / SaaS** (`tenancy: 'multi'`). Many orgs coexist. `instance_admin` is Selva-staff-only; customers — even org owners of the largest tenant — never hold it. **Bootstrap path is closed by default:** the OAuth callback refuses to grant `instance_admin` unless `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is set AND matches the signer. Without this gate, the first random signup would become Selva staff. Operators seed admin explicitly. The env var is safe to leave permanently set — the path is inert once an admin exists. Self-service org creation, plan/billing, and quota gating are deferred — see §12.

---

## 3. Org scope

### Roles

| Role     | Default permissions                                                      |
| -------- | ------------------------------------------------------------------------ |
| `owner`  | All four org permissions. Cannot be demoted by anyone but self-transfer. |
| `admin`  | All four org permissions.                                                |
| `member` | None by default. Grantable: `manage_definitions`, `manage_projects`.     |

> **Owner vs admin in practice.** The two roles share every permission. The structural difference is that **only `owner` can change roles** — promote a `member` to `admin`, demote an `admin`, or transfer ownership (§10). An `admin` can be demoted by an `owner` (or another `admin`'s revocation request, surfaced to owner — see `manage_org_members` below). Treat **owner as the role that cannot lock itself out**: there is always at least one, they survive any admin coup, and they hold the org-transfer authority. Treat **admin as the role you grant freely**: full operational power day-to-day, but revocable. In small orgs the founder is owner and that's it; in larger orgs the owner is whoever holds the contract, with multiple admins doing the operational work.
>
> **A role change resets permissions to the new role's defaults; custom grants do not survive it.** `updateOrgMemberRole` writes `DEFAULT_ORG_PERMISSIONS[role]` over whatever was there, in both providers. So promoting a `member` who held `manage_projects` to `admin` gives them the admin defaults (all four), and demoting them back to `member` leaves them with **none** — the original custom grant is gone and must be re-issued. This is deliberate: a role is the coarse statement of standing and the permission array is a refinement of it, so carrying a refinement across a change of standing would mean a demoted admin silently kept authority their new role does not imply. The cost is that a deliberate custom grant is lost to an unrelated role change, which the UI does not currently warn about. Use the `permissions` branch of the members PATCH to re-grant.
>
> **Admins do not see all projects in the org.** Org role does not grant project visibility. An admin sees only projects they are a member of, plus `org`/`public`-visibility projects per §4. Private projects they are not a project member of are invisible to them (and to the `/projects` listing). The escape hatch is `canReclaim` (§5), which is auditable and adds the admin as a co-owner — this preserves the audit trail rather than letting org role silently bypass project ACLs. (The "no permission inheritance" principle — §13 rule 2.)

### Permissions

| Permission           | What it grants                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manage_org_members` | Invite, remove members; grant/revoke the grantable permissions (`manage_definitions`, `manage_projects`). Owner/admin only — never grantable to `member`. **Does NOT include role changes** — promoting a `member` to `admin`, demoting an `admin`, or transferring ownership is owner-only. One rule, `canChangeOrgRole` (§5), shared by every route that can grant or revoke owner/admin standing. |
| `manage_definitions` | Upload/edit definitions in this org (further gated by project role).                                                                                                                                                                                                                                                                                                                                 |
| `manage_projects`    | Create projects in this org. (Editing/deleting gated by project role.)                                                                                                                                                                                                                                                                                                                               |
| `manage_org_compute` | Create/edit/delete this org's own compute servers (`scope: 'org'`) and set this org's `orgDefaults[orgId]`. Owner/admin only. **Gated by platform flag `ALLOW_ORG_COMPUTE_OVERRIDE`**; when off, this permission is effectively inert — orgs use platform servers shared with them, with the global `defaultServerId` as the baseline. See §3.                                                       |

> **`manage_compute` stays at platform scope.** Platform-server administration — creating servers, choosing which orgs see each one, and setting the global default — is the platform admin's concern. `manage_org_compute` is a separate, org-scoped permission that only grants authority over the org's own servers and the org's default selection, never platform servers.

### Invites

- **Org-scoped only.** You invite a user to an org, not to a project.
- Once in an org, project membership is managed within-org (see §5).
- Cross-org project guests are **out of scope for now.** Deferred (see §12).

### Compute (servers, sharing, defaults)

Compute servers are owned by one of two scopes — never both. The shape is a discriminated union, not a flag:

- **Platform server** (`scope: 'platform'`) — created by `manage_compute`. Carries a `sharedWith: 'all' | string[]` field controlling which orgs can see/use it. `'all'` is the default in `tenancy: 'single'`; in `tenancy: 'multi'` admins assign explicitly.
- **Org-private server** (`scope: 'org'`, `ownerOrgId: string`) — created by an org `owner`/`admin` with `manage_org_compute`. Visible only to that org. Gated by the platform flag `ALLOW_ORG_COMPUTE_OVERRIDE`; when off, this scope cannot be created and any existing rows are inert.

**Defaults are layered:**

- **`defaultServerId`** (global) — set by `manage_compute`. Must reference a platform server. **Always usable by every org regardless of `sharedWith`** — this is the baseline server "any generic user uses." Acts as the floor of the system: every org sees at least this one.
- **`orgDefaults[orgId]`** (per-org override) — set by org `owner`/`admin` with `manage_org_compute`. Must reference a server visible to that org (see visibility rule below). Only meaningful when the org has more than the global default to choose from — i.e., either the admin shared additional platform servers with them, or the org has its own org-private servers (`ALLOW_ORG_COMPUTE_OVERRIDE` on).

A platform server with `sharedWith: []` that is also not the global default is **dormant** — admin-only, unusable for solves until assigned or promoted.

**Visibility rule** (pure function, used by every picker and the resolver):

```
serversVisibleTo(orgId) =
  platformServers.filter(s =>
    s.id === defaultServerId ||
    s.sharedWith === 'all' ||
    s.sharedWith.includes(orgId)
  )
  ∪ orgServers.filter(s => s.ownerOrgId === orgId)   // only when ALLOW_ORG_COMPUTE_OVERRIDE
```

**Resolution order** (pure function, no I/O), narrowest wins:

1. If the definition has `computeServerId` set **and** that server is in `serversVisibleTo(project.orgId)` → use that server. Lets a single heavy definition route to beefier hardware. A pin to a no-longer-visible server falls through (defensive — admin may have un-shared the server since the pin was set).
2. Else, if `orgDefaults[project.orgId]` is set → use that.
3. Otherwise → use the global `defaultServerId`.

An org misconfiguring its own server or default only affects that org's solves. Platform-server administration (creating servers, sharing, setting the global default) is exclusively the `manage_compute` holder's domain and cannot be touched by org admins under any circumstance.

**Type shape:**

```ts
type ComputeServerConfig =
	| {
			scope: 'platform';
			id;
			label;
			serverUrl;
			sharedWith: 'all' | string[]; /* + auth + timeouts */
	  }
	| { scope: 'org'; id; label; serverUrl; ownerOrgId: string /* + auth + timeouts */ };

interface ComputeConfig {
	servers: ComputeServerConfig[];
	defaultServerId: string; // must reference a platform server
	orgDefaults: Record<string, string>; // orgId → serverId; serverId must be visible to that org
}
```

`Definition.computeServerId` is an optional per-definition pin to any server visible to the definition's project's org.

---

## 4. Project scope

### Roles

| Role     | Can view/solve | Can edit definitions | Can manage project |
| -------- | :------------: | :------------------: | :----------------: |
| `owner`  |       ✅       |          ✅          |         ✅         |
| `editor` |       ✅       |          ✅          |         ❌         |
| `viewer` |       ✅       |          ❌          |         ❌         |

`viewer` exists specifically for clients / stakeholders / auditors: they see schemas, submit solves, download results — but cannot modify the definition.

**Platform-admin projects have no project members.** `instance_admin` is the implicit owner via platform role; grants (see §4a) deliver the view/solve entitlement to external parties without creating membership rows.

### Visibility

| Visibility | Who can view/solve                                            |
| ---------- | ------------------------------------------------------------- |
| `private`  | Project members only (explicit owner/editor/viewer role).     |
| `org`      | Any member of the parent org.                                 |
| `public`   | Any authenticated user on the instance. Cross-org.            |
| `platform` | `instance_admin` only, plus explicit grant holders (see §4a). |

**Default for new projects: `private`.** Users opt into broader visibility explicitly.

**Anonymous access is not a project flag** — it's delivered via per-definition **share links** (§7). The project owner mints a link for one definition + channel; the link carries its own cap, expiry, and revocation. There is no "this project is anonymously solvable" mode; explicit per-link grants only.

#### What `private` actually means

`private` means private from everyone who isn't an explicit project member — including org leadership. A member's personal R&D, a project an employee doesn't want their manager to see yet, a side project that happens to live in an org: all of these are valid reasons a user might want a private project, and org admin/owner role does not automatically grant access.

This is a deliberate design decision: **`private` means private, full stop.** The escape hatch for leadership is **Reclaim** (§5 `canReclaim`) — an explicit, auditable action that adds them as co-owner. That audit trail is the load-bearing protection: the cost of "I need to access this" is one intentional step, not a silent default.

**The three privacy scopes, separated by scope not by flag:**

| Need                                       | How                                                    |
| ------------------------------------------ | ------------------------------------------------------ |
| Private from org peers                     | `private` project inside an org                        |
| Visible to org leadership + members        | `org`-visibility project                               |
| Private from everyone including leadership | Personal scope (§12 deferred) — exists outside any org |

Org `owner`/`admin` see `org` and `public` projects by virtue of being org members. They do **not** automatically see `private` projects they aren't a member of — they see the same org-and-public content any member sees, plus they have the Reclaim capability to escalate when genuinely needed.

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
- **Definition owners can edit/delete their own definitions**, for as long as they remain a member of the project's org. They cannot touch anyone else's.
- Project `owner`/`editor` can still edit anyone's definition (moderation).
- No auto-grant of project `editor` role. The flag enables the per-definition ownership gate, nothing else.
- Use for: instance-wide "Shared Scripts" common, community libraries, user-contributed galleries.

The distinction protects the Alice/Peter case: on a commons project, Peter cannot upload a new version of Alice's definition (he isn't its owner and isn't a project editor). Peter can upload _his own_ new definition and edit _that_. Alice's work stays Alice's.

**Commons grants edit on top of belonging, not instead of it.** `canEditDefinition` requires a live org membership alongside `ownerId`, because `ownerId` records who uploaded and is never revisited. Without that second test, removing someone from the org would leave their edit, delete and share-link authority intact over everything they had ever uploaded, and offboarding would not be offboarding. Deliberate consequence: a commons project cannot serve as an anonymous drop-box for people outside the org.

**The project model is chosen at creation time** and changing it later is a deliberate decision. Flipping `autoJoinOnUpload` from false → true is **retroactive** — every existing definition falls under the commons contract at once, with its uploader as definition owner. Combined with the membership test above, this means the flip re-grants edit only to uploaders who are still around; it cannot resurrect a departed contributor's authority.

---

## 4a. Platform-admin projects

A **platform-admin project** is a project with `visibility = 'platform'`. It is owned and operated exclusively by `instance_admin` users. External parties (other orgs or individual users) can be granted **view/solve** access via explicit grants — but they can never edit definitions or manage the project.

### Why a new visibility level, not a new role

The `platform` visibility type keeps the separation clean:

- No project membership rows needed — `instance_admin` governs through platform role.
- Grants are a narrow, auditable entitlement (view/solve only) with no org-membership side effects.
- Adding a new role would be a schema migration and UX churn (§13 rule 1: permissions are extensible, roles are not).

### Creation and management

- Only `instance_admin` can create a `platform` project.
- `instance_admin` can update the project, upload/edit definitions, manage grants, and delete the project.
- `platform` projects live inside a real org (an org whose owner is `instance_admin`). The org provides the tenancy boundary for storage routing and compute resolution; org membership in that org does **not** grant any access to `platform` projects — the visibility type governs everything.
- `autoJoinOnUpload` is not valid on `platform` projects. Cross-field validation (`validateProjectFlags`) rejects the combination.

### Grants

```
PlatformProjectGrant {
  id:          string           PK
  projectId:   string           FK projects(id), ON DELETE CASCADE
  granteeType: 'org' | 'user'
  granteeId:   string           orgId or userId depending on granteeType
  canSolve:    boolean          false = view-only; true = view + solve
  createdBy:   string
  createdAt:   ISO
}
```

- `instance_admin` mints and revokes grants via `/api/admin/projects/[id]/grants`.
- A `granteeType: 'org'` grant applies to **all current and future members** of that org — no per-user expansion needed for org-wide access.
- A `granteeType: 'user'` grant applies to that specific user regardless of org membership.
- Grants are deleted (hard) when revoked. No soft-delete — revocation is immediate and the grant has no downstream references.

### `canView` / `canSolve` for platform projects

```
canView(platform project, user, ctx):
  → user holds instance_admin                         → yes
  → a user grant exists for user.id  AND canSolve OR view-only → yes (view-only grant still allows view)
  → an org grant  exists for ctx.actingOrgId AND canSolve OR view-only → yes
  → otherwise                                         → no

canSolve(platform project, user, ctx):
  → user holds instance_admin                         → yes
  → a user grant exists for user.id  AND grant.canSolve → yes
  → an org grant  exists for ctx.actingOrgId AND grant.canSolve → yes
  → otherwise                                         → no
```

`canSolve` is strictly narrower than `canView` for platform projects: a view-only grant holder can fetch the schema but cannot submit solves.

### `canEdit` / `canEditDefinition` / `canManage` / `canEditProjectSettings` for platform projects

All require `instance_admin`. No project membership, no org-role escape hatch, no Reclaim. Platform staff who need content access already hold `instance_admin`.

This is **not** the §5 `instance_admin` bypass — for platform projects, admin status IS the rule. The bypass distinction (`managementBypassOrRun` vs `contentCheck`) only matters for non-platform projects where admins are forbidden from content access without explicit Reclaim.

> **No Reclaim on platform projects.** The Reclaim flow (`canReclaim`, §5) is an org-leadership escape hatch for org-owned projects whose owner left. Platform projects have no org ownership to reclaim — they are governed by `instance_admin` exclusively. `canReclaim` returns `false` when `project.visibility === 'platform'`.

### API routes

| Route                                       | Method             | Rule                                                                 |
| ------------------------------------------- | ------------------ | -------------------------------------------------------------------- |
| `/api/admin/projects`                       | `POST`             | `instance_admin`. Creates a `platform` project.                      |
| `/api/admin/projects/[id]`                  | `GET/PATCH/DELETE` | `instance_admin`.                                                    |
| `/api/admin/projects/[id]/grants`           | `GET/POST`         | `instance_admin`. POST body: `{ granteeType, granteeId, canSolve }`. |
| `/api/admin/projects/[id]/grants/[grantId]` | `DELETE`           | `instance_admin`. Hard-delete (immediate revocation).                |

Definitions on platform projects use the existing `/api/v1/definitions/*` routes — the auth layer reads `project.visibility` and applies the platform-project rules above.

### Scenarios

| Scenario                                                                         | Outcome                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `instance_admin` uploads a definition to a `platform` project.                   | **OK.** `canEditDefinition` passes — admin always qualifies.                   |
| Acme org member navigates to a `platform` project URL.                           | **403.** No grant exists for them.                                             |
| `instance_admin` grants Acme org `canSolve = true`.                              | All Acme org members can now view and solve.                                   |
| `instance_admin` grants Acme org `canSolve = false` (view-only).                 | Acme members can fetch the schema / view the project but cannot submit solves. |
| `instance_admin` grants a specific user `canSolve = true`.                       | That user can view and solve, regardless of their org.                         |
| Acme org admin tries to Reclaim a `platform` project.                            | **403.** `canReclaim` returns false for `platform` visibility.                 |
| `instance_admin` tries to set `autoJoinOnUpload = true` on a `platform` project. | **400.** `validateProjectFlags` rejects the combination.                       |

---

## 5. Rules

The pure access-control functions live in [rules.ts](../../platform/src/access/rules.ts). They take already-resolved entities as input and return booleans. Adapters do the lookup; rules do the logic.

> **Single source of truth.** Every gate — adapter `can*` methods, route-layer `requireCan*` helpers — funnels through `rules.ts`. No predicate is duplicated; the route layer pre-loads the membership rows the rule needs and calls it directly. Cross-org-public visibility short-circuits the fetch so the hot path stays cheap.

### The `instance_admin` bypass is split: management yes, content no

The bypass is centralized in [access.server.ts](../src/lib/server/access.server.ts) as two separate wrappers, not one:

**`managementBypassOrRun`** — used for governance actions: Reclaim, create/delete project, manage project members, edit project settings, create org. `instance_admin` bypasses these so platform staff can administer the instance without being a member of every org.

**`contentCheck`** — used for content access: `canView`, `canSolve`, `canEdit`, `canEditDefinition`. **No bypass.** `instance_admin` runs the same rules as any other user. If platform staff need to access content in a private project, they Reclaim first — the audit trail attaches to that explicit escalation, not to a silent default.

The pure rules below reason about **normal users only** in both cases. This matters because: (1) a bug in a rule doesn't become a bug in god-mode, (2) the wrapper is the future hook point for audit logging, and (3) keeping content and management bypass separate makes the security boundary explicit and reviewable in one place.

### Share-link grants are a parallel path

A request authenticated by a valid share-link token (§7) is granted access to **one specific (definitionId, channel) pair only**, regardless of project visibility or membership. Token validation runs **before** the user-based rules below in the request pipeline; if a valid token resolves, those rules are skipped for that request. See §7 for the token contract.

### `canView(project, user, ctx) → bool`

- `private` → yes iff user is a project member (any role)
- `org` → yes iff `ctx.actingOrgId === project.orgId` **and** user is a member of that org
- `public` → yes iff user is authenticated on the instance, **and** either `ALLOW_CROSS_ORG_PUBLIC=true` OR the user is a member of the project's parent org. With the flag off, `public` narrows to "everyone in the publishing org" — the visibility flip is still allowed (see `canChangeVisibilityToPublic`), but the reach is the org rather than the instance.
- `platform` → yes iff user holds `instance_admin`, OR a user grant exists for `user.id`, OR an org grant exists for `ctx.actingOrgId`. Both grant types (view-only and canSolve) satisfy `canView`.

### `canSolve(project, user, ctx) → bool`

A distinct function from `canView`. For non-platform projects **today its body is `canView(...)`** — if you can see it, you can solve it. For `platform` projects the bodies diverge: `canView` accepts any grant holder; `canSolve` requires `grant.canSolve = true`.

It exists as a separate function so future solve-gating (cost quotas, rate limits, compute-budget checks) has an obvious home without touching every call site or retrofitting `canView` semantics. Authorization and cost are two different concerns; keeping the functions distinct keeps them from tangling.

### `canEdit(project, user) → bool` — project-level edit gate

- Project `owner` or `editor` → yes
- Otherwise → no

The generic "can this user touch project-scoped resources" predicate. Used where the gate is project-level and definition ownership doesn't apply: filtering the project list to ones the caller can edit, gating new-definition uploads on container projects (commons projects skip this and use the §4 commons contract), and as the building block for `requireCanEdit` in the access layer. Distinct from `canEditDefinition` (which adds the commons-mode definition-owner branch) and `canEditProjectSettings` (owner-only).

### `canEditDefinition(project, definition, user) → bool`

- Project `owner` or `editor` → **yes** (always — moderation authority)
- Project has `autoJoinOnUpload=true` **and** `user.id === definition.ownerId` **and** the user is still a member of the project's org → **yes** (commons: you own what you uploaded, while you are still here)
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

**`private → org` is deliberately ungated, and the asymmetry with `→ public` is intentional.** Only the flip to `public` consults this rule; a project owner who is a plain org `member` can move their own project from `private` to `org` on their own authority. `org` exposes the project inside the tenant that already owns it, so the disclosure boundary this rule defends is not crossed — and gating it would mean a member could not share their own work with their own colleagues without asking leadership, a real cost against a small risk. Worth revisiting only if orgs grow large enough that "everyone in the org" stops being a meaningful trust boundary.

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

The route handler at `/api/v1/projects/[id]/members/[userId]` `DELETE` consults this and translates the result to the appropriate HTTP response.

### `canChangeOrgRole(actorMember, role) → bool` — the owner boundary

Whether the actor may hand out or take away org `owner`/`admin` standing (§3):

- `role === 'member'` → **yes** (ordinary member management is what `manage_org_members` is for)
- Otherwise → actor's membership row must be `owner`

**Three routes decide this and all three call this function**: inviting someone as owner/admin, changing an existing member's role, and removing an owner. They were previously three hand-written copies, and two had drifted — the invite route let an admin mint themselves an `owner` invite, and member `DELETE` let an admin remove an owner that `PATCH` would not let them demote. A demoted owner can be re-promoted; a removed one has lost every project membership to the cascade, so the less guarded path was the harder one to undo.

Role _changes_ are gated on both ends — the role being granted and the one being taken away — because demoting an owner crosses the boundary even though `member` does not.

Reads the **membership row**, never `Organization.ownerId`. Those are separate fields and can disagree; only the row is authority here.

### `canReclaim(project, user, ctx) → bool` — org owner/admin escape hatch

Org leadership can reclaim any project in their org to regain access (e.g., original owner left the company):

- `project.visibility === 'platform'` → **no** (platform projects have no org ownership to reclaim; `instance_admin` always has management access)
- `ctx.actingOrgId === project.orgId` **and** user is org `owner` or `admin` → yes
- Otherwise → no

**The platform-project refusal is enforced ahead of the management bypass**, in `requireCanReclaim` rather than inside the rule. `managementBypassOrRun` short-circuits for `instance_admin`, which is the only role that can reach a platform project at all — so a refusal that lived only in the rule would never execute. Reclaim is content escalation wearing management clothing; the bypass is not its to inherit.

**Reclaim adds the actor as a co-owner.** It does **not** demote the existing owner. This preserves the original owner's access if they return.

**Reclaim emits `project.reclaimed`**, carrying `projectId`, `orgId`, `actorId` and the `priorVisibility` at the moment of escalation. `addProjectMember` also emits its usual `project_member.added`, but that event is indistinguishable from an owner adding a teammate — and §4 rests the whole escape hatch on the escalation being visible afterwards. `priorVisibility` is recorded because a later visibility flip would otherwise rewrite how serious the entry looks.

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

| Channel | Points to        | Who can solve it                                                                                                                                  |
| ------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live`  | `liveVersionId`  | Anyone who passes `canSolve` for the project.                                                                                                     |
| `draft` | `draftVersionId` | Whoever passes `canEditDefinition` — project `owner`/`editor`, or on a commons project the definition's own owner while still an org member (§4). |

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

When a request to a definition-scoped route (`/api/v1/compute/solve`, `/app/[guid]`, schema fetch) carries `?token=…` (or `Authorization: Bearer …`):

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

Authoritative mapping of HTTP routes to rule checks. **Every shipped route appears here**, enforced by a conformance test (`api/v1/__tests__/conformance.test.ts`) that walks `routes/api/**` and fails on any handler this table does not list — an unlisted route is an authorization decision nobody reviewed. Rows for endpoints that are not built yet are fine and say so.

`instance_admin` passes rows gated on **management** scope, via the centralized bypass (§5). It does **not** pass content rows — `canView`, `canSolve`, `canEdit` and `canEditDefinition` run unchanged for platform staff (§2), and Reclaim is the auditable escalation path. `canReclaim`'s platform-project refusal is checked ahead of the bypass for the same reason (§5).

**CSRF is Origin-checked on form posts only.** SvelteKit's default `csrf.checkOrigin` covers form-like content types; `application/json` requests are not Origin-checked, so the JSON API relies on the session cookie's `SameSite` attribute rather than on an Origin header. Deliberate — a stricter check would break legitimate cross-origin API clients once PATs land — but it means **a same-origin XSS can call any authenticated endpoint**, so the frame-ancestors and script-src headers in `applySecurityHeaders` (`@selvajs/server/http`) are load-bearing, not hygiene.

### Content API (`/api/*`)

| Route                                                    | Method        | Rule                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/projects`                                       | `GET`         | _Not implemented yet._ The listing lives in the `/projects` page load; the HTTP endpoint is authored in API v1 Phase B against the same `canView` filtering. Org `owner`/`admin` is **not** a substitute for project membership; private projects they aren't a member of must not appear.                                                        |
| `/api/v1/projects`                                       | `POST`        | `canCreateProject(targetOrg, user, ctx)`                                                                                                                                                                                                                                                                                                          |
| `/api/v1/projects/[id]`                                  | `GET`         | `canView(project, user, ctx)`                                                                                                                                                                                                                                                                                                                     |
| `/api/v1/projects/[id]`                                  | `PATCH`       | `canEditProjectSettings`. Visibility → `public` additionally requires `canChangeVisibilityToPublic`.                                                                                                                                                                                                                                              |
| `/api/v1/projects/[id]`                                  | `DELETE`      | `canManage(project, user)`                                                                                                                                                                                                                                                                                                                        |
| `/api/v1/projects/[id]/reclaim`                          | `POST`        | `canReclaim(project, user, ctx)`                                                                                                                                                                                                                                                                                                                  |
| `/api/v1/projects/[id]/members`                          | `GET/POST`    | `canManage(project, user)`. Target user must be org member (rule layer).                                                                                                                                                                                                                                                                          |
| `/api/v1/projects/[id]/members/[userId]`                 | `PATCH`       | `canManage(project, user)`                                                                                                                                                                                                                                                                                                                        |
| `/api/v1/projects/[id]/members/[userId]`                 | `DELETE`      | `canManage(project, user)`. Sole-owner removal blocked. Owner-on-owner removal requires `?confirm=true`.                                                                                                                                                                                                                                          |
| `/api/v1/definitions`                                    | `GET`         | Authenticated. Lists definitions across the caller's `canView` project set (`resolveAccessibleProjects`), never an unfiltered store read.                                                                                                                                                                                                         |
| `/api/v1/definitions`                                    | `POST`        | **Create new definition.** Container mode: project `owner`/`editor`. Commons mode (`autoJoinOnUpload=true`): any authenticated user; handler sets `definition.ownerId = user.id`.                                                                                                                                                                 |
| `/api/v1/definitions/[guid]`                             | `GET`         | `canView` via `getVisibleDefinition` — **404, never 403**, on a guid the caller cannot see.                                                                                                                                                                                                                                                       |
| `/api/v1/definitions/[guid]/schema`                      | `GET`         | `canView` via `getVisibleDefinition` + `loadVisibleVersion` on the `live` channel. Same 404-not-403 contract.                                                                                                                                                                                                                                     |
| `/api/v1/definitions/[guid]/versions`                    | `POST`        | **New version of existing definition.** `canEditDefinition`. Creates a new `DefinitionVersion`; advances `draft`.                                                                                                                                                                                                                                 |
| `/api/v1/definitions/[guid]`                             | `PATCH`       | `canEditDefinition` (metadata only).                                                                                                                                                                                                                                                                                                              |
| `/api/v1/definitions/[guid]`                             | `DELETE`      | `canEditDefinition`                                                                                                                                                                                                                                                                                                                               |
| `/api/v1/definitions/[guid]/image`                       | `POST`        | `canEditDefinition`                                                                                                                                                                                                                                                                                                                               |
| `/api/v1/definitions/[guid]/publish`                     | `POST`        | `canEditDefinition`. Body `{ versionId? }`; advances `live` to a target version (current `draft` or any prior version for rollback).                                                                                                                                                                                                              |
| `/api/v1/definitions/[guid]/versions`                    | `GET`         | `canView`, resolved through `getVisibleDefinition` — an invisible guid **404s, never 403s**, like its `[guid]` and `[guid]/schema` siblings. Answering "forbidden" for a guid the caller cannot see turns the route into a cross-tenant existence oracle.                                                                                         |
| `/api/v1/definitions/[guid]/versions/[versionId]`        | `GET`         | `canView` via `loadVisibleVersion`, which re-checks `version.definitionId === guid` so a valid version id under someone else's guid is not an IDOR.                                                                                                                                                                                               |
| `/api/v1/definitions/[guid]/versions/[versionId]/schema` | `GET`         | `canView` via `loadVisibleVersion`. Same guid/version pairing check.                                                                                                                                                                                                                                                                              |
| `/api/v1/definitions/[guid]/versions/[versionId]`        | `DELETE`      | `canEditDefinition`. §6 deletion protection — 409 if version is referenced by `liveVersionId`/`draftVersionId`.                                                                                                                                                                                                                                   |
| `/api/v1/definitions/[guid]/share-links`                 | `GET/POST`    | `canEditDefinition`. POST returns the raw token once.                                                                                                                                                                                                                                                                                             |
| `/api/v1/definitions/[guid]/share-links/[linkId]`        | `DELETE`      | `canEditDefinition`. Soft-delete (sets `revokedAt`).                                                                                                                                                                                                                                                                                              |
| `/api/v1/compute`                                        | `POST`        | **The URL-addressed solve**, taking an arbitrary `definitionUrl`. `canSolve(project, user, ctx)`. Channel: `live` (default) or `draft`; `draft` requires `canEditDefinition`. **The only route that accepts a share token** — a valid `?token=…` (§7) bypasses user auth and grants the token's pinned scope only.                                |
| `/api/v1/definitions/[guid]/solve`                       | `POST`        | The definition-addressed solve. Same `canSolve` gate, but authenticated users only — this route has no share-token branch and must never grow one; `definitionUrl` must equal `local:{guid}` or be omitted.                                                                                                                                       |
| `/api/v1/compute/schema`                                 | `POST`        | `requireCanCreateDefinition(projectId)` — same gate as creating a definition. Container projects need owner/editor; commons projects accept any authenticated user. The target project's `orgId` selects BYO compute. Used by the upload dialog to preview a user-supplied .gh file's schema before saving.                                       |
| `/api/v1/orgs/[orgId]/compute`                           | `GET/PATCH`   | `manage_org_compute`. Gated by `ALLOW_ORG_COMPUTE_OVERRIDE` platform flag. URL `orgId` must equal `ctx.actingOrgId` (403 otherwise).                                                                                                                                                                                                              |
| `/api/v1/orgs/[orgId]/assets/[kind]`                     | `POST/DELETE` | `manage_org_members` — org branding is an org-admin action, not a platform one. URL `orgId` must equal `ctx.actingOrgId`.                                                                                                                                                                                                                         |
| `/api/v1/orgs/[orgId]/members/[userId]`                  | `PATCH`       | Body `{ role?, permissions? }`. URL `orgId` must equal `ctx.actingOrgId`. Role change branch is `canChangeOrgRole` (§5), gated on both the new and the old role; permission change branch is `manage_org_members`. Cannot demote the sole owner (409). For `member`-role targets, `permissions` is restricted to `MEMBER_ASSIGNABLE_PERMISSIONS`. |
| `/api/v1/orgs/[orgId]/members/[userId]`                  | `DELETE`      | `manage_org_members` + `canChangeOrgRole` (§5) on the target's role — removing an owner is owner-only. Cannot remove the sole owner (409). Cascades `project_members`, revokes pending invites for the same email, and emits `org_member.removed_orphaning_projects` for any project left ownerless (§10).                                        |
| `/api/v1/orgs/[orgId]/members`                           | `GET`         | **Any member of the acting org** — `requireActingOrg` only. The roster is what the team page renders. Note this returns each member's `permissions` array to every colleague, not just to leadership; narrowing the response shape is open (finding 20).                                                                                          |
| `/api/v1/orgs/[orgId]/invites`                           | `GET/POST`    | `manage_org_members`. URL `orgId` must equal `ctx.actingOrgId` (403 otherwise). POST additionally runs `canChangeOrgRole` (§5) on the invited role — an invite is a second door into `org_members`.                                                                                                                                               |
| `/api/v1/orgs/[orgId]/invites/[id]`                      | `DELETE`      | `manage_org_members`. Same tenancy check.                                                                                                                                                                                                                                                                                                         |
| `/api/v1/orgs/[orgId]`                                   | `GET`         | Any member of the acting org — `requireActingOrg` only. URL `orgId` must equal `ctx.actingOrgId` (403 otherwise).                                                                                                                                                                                                                                 |
| `/api/v1/me`                                             | `GET`         | Authenticated. Returns the caller's own identity and resolved context; reads `locals.user` and nothing else.                                                                                                                                                                                                                                      |
| `/api/v1/me/starred/[guid]`                              | `PUT/DELETE`  | Authenticated. Acts on `locals.user.id`'s own profile only — `IUserProfileStore` enforces self-or-admin scoping.                                                                                                                                                                                                                                  |
| `/api/files/[...path]`                                   | `GET`         | Storage proxy. Public buckets serve unauthenticated; private buckets require an authenticated session whose ctx authorizes the resource the path encodes.                                                                                                                                                                                         |

### Admin API (`/api/admin/*`)

Instance-level only. Denial returns **403** (not redirect).

| Route                                       | Method             | Permission                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/admin/users`                          | `*`                | `manage_instance_users`                                                                                                                                                                                                        |
| `/api/admin/users/[id]`                     | `PATCH/DELETE`     | `manage_instance_users`. PATCH that changes platform-scope perms additionally requires `instance_admin`. DELETE consults `IPlatformPermissionStore.countInstanceAdminsExcluding` and returns 409 when removing the sole admin. |
| `/api/admin/users/[id]/disable`             | `POST`             | `manage_instance_users`. Same sole-admin invariant as DELETE.                                                                                                                                                                  |
| `/api/admin/compute`                        | `*`                | `manage_compute`                                                                                                                                                                                                               |
| `/api/admin/compute/status`                 | `GET`              | `manage_compute`                                                                                                                                                                                                               |
| `/api/admin/compute/actions`                | `POST`             | `manage_compute`. Operational actions against a configured server (restart, cache clear) — not config writes.                                                                                                                  |
| `/api/admin/system/update`                  | `GET/POST`         | `instance_admin`. POST runs the self-update and streams SSE; GET either polls the npm registry (`?check=1`) or returns the tee'd update log so the UI can recover output from the restart blackout.                            |
| `/api/admin/system/health`                  | `GET`              | `instance_admin` — re-runs the integrity checks live and names which compute servers failed and why.                                                                                                                           |
| `/api/admin/system/throughput`              | `GET/POST`         | `instance_admin`. Bandwidth probe: GET streams random bytes downstream, POST consumes and discards an upload. The download side is a data faucet, hence the narrowest gate.                                                    |
| `/api/admin/orgs`                           | `*`                | `instance_admin`                                                                                                                                                                                                               |
| `/api/admin/projects`                       | `GET/POST`         | `instance_admin`. GET lists every `platform`-visibility project on the instance; POST creates one. Both 404 when `ENABLE_PLATFORM_PROJECTS` is off.                                                                            |
| `/api/admin/orgs/[id]`                      | `*`                | `instance_admin`                                                                                                                                                                                                               |
| `/api/admin/projects/[id]`                  | `GET/PATCH/DELETE` | `instance_admin`.                                                                                                                                                                                                              |
| `/api/admin/projects/[id]/grants`           | `GET/POST`         | `instance_admin`. POST body: `{ granteeType, granteeId, canSolve }`.                                                                                                                                                           |
| `/api/admin/projects/[id]/grants/[grantId]` | `DELETE`           | `instance_admin`. Hard-delete (immediate revocation).                                                                                                                                                                          |

### The two-shell rule

Selva has two distinct admin areas, and they never mix:

- **`/admin/*`** — the **platform** shell. About the whole Selva instance: every user, every org, the instance compute pool, system updates. Gated on platform perms.
- **`/team/*`** — the **organization** shell. About one org the user is acting in: its members, projects, compute override, settings. Gated on org perms.

**No route appears in both.** Reclaim is an org concern → `/team/reclaim`. Managing instance users is a platform concern → `/admin/users`. A user who happens to hold both kinds of authority (e.g., Selva staff who is also an org owner) navigates between `/admin` and `/team` via the header — the views are not merged.

### Admin pages (`/admin/*`)

Instance-level only. The shell admits **platform** perms exclusively — org-scope perms (`manage_org_members`, `manage_org_compute`, `manage_definitions`, `manage_projects`) never grant entry, even though they share the `manage_*` prefix. Sub-page denial redirects to `/admin`; layout-level denial (no platform perm at all) redirects to `/app`.

| Page                 | Permission              |
| -------------------- | ----------------------- |
| `/admin` (dashboard) | Any platform perm       |
| `/admin/users`       | `manage_instance_users` |
| `/admin/compute`     | `manage_compute`        |
| `/admin/orgs`        | `instance_admin`        |
| `/admin/update`      | `manage_updates`        |

### Team pages (`/team/*`)

Org-level only. The shell admits **org** perms exclusively — platform perms (`instance_admin`, `manage_compute`, etc.) never grant entry on their own, though `instance_admin`'s centralized bypass (§5) means staff can still load these pages while acting in any org. Tenancy is implicit via `ctx.actingOrgId`; routes never accept a target org via URL or query. Sub-page denial redirects to `/team`; layout-level denial (no `actingOrgId`, or no org membership) redirects to `/app`.

| Page              | Permission                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/team` (general) | Any org membership                                                                                                                                        |
| `/team/members`   | `manage_org_members`. Role changes (member↔admin, transfer) owner-only (§3)                                                                               |
| `/team/projects`  | `manage_projects`                                                                                                                                         |
| `/team/reclaim`   | `manage_org_members` (proxy for org owner/admin per §3); load-bearing check is `canReclaim` (§5) on the API endpoint                                      |
| `/team/activity`  | Any org membership                                                                                                                                        |
| `/team/shares`    | `manage_definitions`                                                                                                                                      |
| `/team/compute`   | `manage_org_compute`. Server-add controls hidden when `ALLOW_ORG_COMPUTE_OVERRIDE` is off; default-selection still works against shared platform servers. |
| `/team/settings`  | `manage_org_members`                                                                                                                                      |

### Auth flow (`/auth/*`)

Public routes — the auth round-trip IS the credential flow, so no permission check applies. Used when `SUPABASE_OAUTH_PROVIDERS` is set.

| Route                     | Method | What it does                                                                                                                                                                                                                                                                        |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/supabase/start`    | `GET`  | `?provider=google&redirectTo=/app` — mints an OAuth authorize URL via Supabase and redirects.                                                                                                                                                                                       |
| `/auth/supabase/callback` | `GET`  | `?code=…` — exchanges the code for a session, sets `admin_session` + `admin_refresh` cookies, redirects to `redirectTo`. **First-OAuth-signin-becomes-admin:** if no `instance_admin` exists, the new user is granted every platform permission via `IPlatformPermissionStore.set`. |

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

- `Definition.ownerId` is **not nullable** and is set to the uploader at creation time. No route changes it. Note that `DefinitionRecordPatch` still types it as writable, so this is convention rather than a type guarantee — a future patch route wiring `ownerId` through would silently transfer edit authority on a commons project.
- In the container model (`autoJoinOnUpload=false`) it is display metadata only. In the commons model (`autoJoinOnUpload=true`) it is an access-control input — a commons definition is editable by project editors, or by its owner while they remain an org member (§4).
- If the owner's account is deleted, `ownerId` points at an unresolvable id; UI renders "Deleted user" and the definition effectively becomes editable only by project editors (moderation path).

### Events (future-proofing)

Every successful mutation emits an internal domain event (`project.created`, `definition.published`, `member.removed`, `share_link.minted`, `share_link.revoked`, …). The Supabase deployment wires `SupabaseEventSink`, persisting every event to `public.audit_events` (type, actor, timestamp, full JSONB payload). The local provider stays on `NoopEventSink` — dev mode has no audit requirement. Webhook dispatch and the audit-log viewer UI plug in later as additional `IEventSink` implementations.

---

## 10. Offboarding & ownership transfer

- **Disable user (instance-wide):** `manage_instance_users` sets `disabled=true`. Identity and attribution preserved.

  **Cutoff is bounded, not instant, and the bound differs per provider.** `sessionRefresh.revokeSession` takes the _target's_ session token, which an admin disabling someone else does not hold, and neither the interface nor GoTrue's admin API offers revocation by user id — so this route cannot force an immediate cutoff.

  | Provider          | An already-issued session after disable                              |
  | ----------------- | -------------------------------------------------------------------- |
  | Local (HMAC)      | Dies on the next request — `verifyToken` re-reads the user           |
  | header-auth       | Dies on the next request — every request re-identifies from headers  |
  | Supabase (hybrid) | Accepted until `revalidateMs` elapses (default 60s), then re-checked |
  | Supabase (strict) | Dies on the next request                                             |

  In no case does the 30-day refresh token survive: `refreshSession` rejects a disabled user, so nothing new can be minted and the window is bounded by the access token's own lifetime. Closing the remaining seconds needs `revokeAllForUser` on `ISessionRefresh` plus a privileged RPC deleting `auth.refresh_tokens` rows — out of proportion to a 60-second window, so it is deliberately not built.

  **Logout is different and is fully closed.** `/logout` revokes provider-side before clearing the cookie, so a captured token from a shared machine does not outlive the session.

- **Remove user from org:** org `owner`/`admin` or `manage_org_members`. User loses all project memberships in that org. Still exists on the instance.

  **Pending invites addressed to them are revoked** — by email, not by user id, since an invite names an address and the account it will create may need not exist yet. One `revokePendingByEmail(ctx, orgId, email)` call rather than list-then-revoke-each, so a concurrent accept cannot slip between two round-trips. Without this, removal left a live re-entry route: an unaccepted invite stayed valid for its full 7-day TTL and readmitted the user at their original role. A failure here is logged, not fatal — the removal has already committed, and reporting an offboarding that did happen as one that didn't is the worse outcome.

  **Share links they minted stay live, on purpose.** A share link is an org asset that happens to have a minter; the party inconvenienced by revoking it is whoever holds the URL — usually a client — not the person leaving, who had an account rather than a link. Cascade-revoke also only fires on org-member removal, so disabled and deleted users' links would survive it anyway. The compensating control is the **org-wide share-link roster** at `/team/shares`, gated on `manage_org_members` (never `manage_projects`, which a plain member may hold and has no business enumerating every credential in the tenant). Seeing the roster does not confer authority over it: revoking still requires edit rights on the parent definition, so the page reuses the per-definition DELETE endpoint. Auto-revoke is a policy that can be layered on the roster later; the reverse does not work.

- **Sole-owner projects on offboarding:** removal **proceeds**, and the projects left without an owner are reported via `org_member.removed_orphaning_projects` (one event listing all of them). No silent reassignment, and no block.

  Blocking was the earlier rule and was retired deliberately. Its cost scales with how many projects the departing person owned, which is backwards — the most prolific people are the ones whose departure most needs to be clean — and an offboarding that stalls halfway leaves that person in the org while someone works through the backlog. An ownerless project is recoverable at leisure; a half-finished removal is a live account. **Reclaim** (§5 `canReclaim`) already exists to adopt an ownerless project, so the recovery path was built before the problem was named; what was missing was any signal that recovery was needed.

  The check runs **before** the removal, because `removeOrgMember` cascades the `project_members` rows it reads.

- **Sole instance admin:** revoking `instance_admin`, deleting, or disabling the last user holding `instance_admin` is **blocked** at the data layer (`IPlatformPermissionStore`) — the operation returns `last_admin`, which the API surfaces as **409 Conflict** with an actionable message ("Promote another user to instance admin first"). For revocation the store enforces the invariant directly inside `set`. For delete/disable the route handler consults `countInstanceAdminsExcluding(targetUserId)` BEFORE calling the auth provider, since the auth provider only handles identity and doesn't know about Selva-specific permissions. The admin UI mirrors the lock by disabling the relevant control on the sole admin and surfacing the reason. Symmetric with sole-owner project removal above. Non-runtime corruption (manual DB edits, bad migrations, backup restore) is recoverable via `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` (§2).
- **Delete user (hard):** admin-initiated only. Goes through the auth provider. Selva's references resolve to "Deleted user." Share links the user minted are unaffected (they belong to the definition, not the creator).
- **Org ownership transfer:** explicit action by the current org owner. `instance_admin` can force-transfer as a break-glass.

---

## 11. Scenarios (sanity checks)

Walk through these to confirm the model behaves as expected.

| Scenario                                                                                                                                                       | Outcome                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alice (Acme `admin`) creates a `private` project.                                                                                                              | Alice is project `owner`. Only project members can view or solve.                                                                                                                                                                                                                             |
| Bob (Acme `member`, no project membership) navigates directly to the private project URL.                                                                      | **403.** Visibility is enforced on solve too.                                                                                                                                                                                                                                                 |
| Carol (BigClient `member`) navigates to Acme's `org` project URL.                                                                                              | **403.** `ctx.actingOrgId` doesn't match Acme's org.                                                                                                                                                                                                                                          |
| Bob (Acme `member`, no project membership) views/solves an Acme `org` project.                                                                                 | **OK.** `canView`/`canSolve` pass — org visibility grants view + solve to all org members.                                                                                                                                                                                                    |
| Bob (Acme `member`, no project membership) tries to edit the same `org` project's definition.                                                                  | **403.** `canEditDefinition` requires explicit project `owner`/`editor` role — org membership alone is view + solve, not edit.                                                                                                                                                                |
| Dave (authenticated, any org) navigates to a `public` project Alice published.                                                                                 | **OK.** Cross-org public visible to any authenticated user (with platform flag on).                                                                                                                                                                                                           |
| Bob uploads a **new** definition to a `public` + `autoJoinOnUpload=true` commons project.                                                                      | **OK.** Definition created with `ownerId = Bob`. Bob is the definition owner — _not_ a project member. He can edit/delete this one definition; he cannot touch anyone else's.                                                                                                                 |
| Alice (definition owner on commons) uploads `v2` of her own definition.                                                                                        | **OK.** `canEditDefinition` passes because Alice is the definition's owner. `draft` = `v2`, `live` = `v1` until she publishes.                                                                                                                                                                |
| **Peter (random authenticated user, no project membership) tries to upload `v2` on Alice's definition in a commons project.**                                  | **403.** Peter is not the definition owner and not a project editor. The "anyone can contribute" opt-in does **not** mean "anyone can vandalize existing work."                                                                                                                               |
| Peter (random user) uploads his _own_ new definition to the same commons project.                                                                              | **OK.** New definition, `ownerId = Peter`. Peter can edit his own; Alice's remains untouchable to him.                                                                                                                                                                                        |
| Alice (project owner on a commons project) moderates Peter's definition (it's inappropriate).                                                                  | **OK.** Project owner/editor retains full moderation authority over every definition in the project regardless of commons mode.                                                                                                                                                               |
| Alice realizes `v2` is broken. Rolls `live` back to `v1`.                                                                                                      | `live` re-points to `v1`. `v2` still exists, can be re-published after fixes.                                                                                                                                                                                                                 |
| Alice tries to delete `v1` while it's the live version.                                                                                                        | **409.** §6 deletion protection — repoint `live` first.                                                                                                                                                                                                                                       |
| Alice (project `editor`) tries to edit project settings.                                                                                                       | **403.** Editors cannot edit settings. Promote to owner if needed.                                                                                                                                                                                                                            |
| Alice (project `viewer`) tries to delete a definition.                                                                                                         | **403.** Viewers cannot edit.                                                                                                                                                                                                                                                                 |
| Project owner leaves Acme. Org owner opens the project.                                                                                                        | Uses **Reclaim** → becomes co-owner. Original owner not demoted. Emits `project.reclaimed` with the prior visibility.                                                                                                                                                                         |
| Reclaim done; co-owner tries to remove the original owner.                                                                                                     | Handler surfaces owner-on-owner confirm step (`?confirm=true`) before proceeding.                                                                                                                                                                                                             |
| Alice flips a `private` project to `public`.                                                                                                                   | Requires org `owner`/`admin` (Alice qualifies as `admin`). If cross-org public is off at platform level, flip is rejected.                                                                                                                                                                    |
| Alice (Acme `admin`) tries to promote Bob (`member`) to `admin`.                                                                                               | **403.** Role changes are owner-only (§3). Alice can grant Bob `manage_definitions` / `manage_projects` permissions, but not change his role.                                                                                                                                                 |
| Alice (Acme `admin`) tries to demote another `admin` to `member`.                                                                                              | **403.** Role changes are owner-only. Admins cannot expand or contract their peer group; only owner can.                                                                                                                                                                                      |
| Alice (Acme `admin`) grants Bob (`member`) the `manage_projects` permission.                                                                                   | **OK.** `manage_org_members` covers grantable permissions. Bob can now create projects but his role stays `member`.                                                                                                                                                                           |
| Marcus (Acme `admin`, no project memberships) opens `/projects`.                                                                                               | He sees `org` and `public` Acme projects (any org member's entitlement) but **not** private ones he isn't a member of (e.g., R&D Sandbox). `private` means private from everyone without a membership — including org leadership. Reclaim is the explicit escalation path if he needs access. |
| Bob (Acme `member`, no project memberships) opens `/projects`.                                                                                                 | Same as Marcus — he sees `org`/`public` projects only. Private projects he's not a member of do not appear.                                                                                                                                                                                   |
| `instance_admin` tries to view a private Acme project they are not a member of.                                                                                | **403.** Content access follows `canView` regardless of platform role — no bypass (§2, §5). Reclaim is the explicit path, which then creates an audit row.                                                                                                                                    |
| `instance_admin` manages Acme's org settings (members, compute config).                                                                                        | **OK.** Management actions use `managementBypassOrRun` — platform staff can administer the instance without being a member of every org.                                                                                                                                                      |
| Alice mints a `live`-channel share link for her definition with a 1000-solve cap. Bob (no account) solves 999 times via the link; the 1000th request hits 429. | **OK.** Cap enforced by atomic increment. Alice raises the cap, removes it, or revokes.                                                                                                                                                                                                       |
| Alice mints a `draft`-channel share link for QA review. The reviewer (no account) opens it and solves the unpublished version.                                 | **OK.** Token grants the pinned channel only. The reviewer cannot switch to `live` from the same token.                                                                                                                                                                                       |
| Alice's share link gets posted publicly and starts seeing a flood of solves. Alice clicks **Revoke**.                                                          | The link 401s on next use. Existing in-flight solves complete; subsequent ones fail at token resolution.                                                                                                                                                                                      |
| Alice deletes the definition that a share link points at.                                                                                                      | Token resolution fails closed (`def.deletedAt IS NULL` check). Hard delete cascades the link out.                                                                                                                                                                                             |
| Acme org configures an org-private compute server and sets it as `orgDefaults[acme]`; platform has `ALLOW_ORG_COMPUTE_OVERRIDE=true`.                          | Solves on Acme projects route to Acme's server. Solves on other orgs' projects continue to use the global default (or that org's own override).                                                                                                                                               |
| `instance_admin` shares an existing platform server with Acme org by adding Acme to `sharedWith`.                                                              | Acme members see the server in their picker and can pin definitions to it; Acme owner can promote it to `orgDefaults[acme]`. The server remains a platform-owned row — Acme cannot edit or delete it.                                                                                         |
| `instance_admin` edits platform compute config (creates a server, changes sharing, changes global default) while their `actingOrgId` is set.                   | Edits the **platform-server set** regardless of `actingOrgId` — `/api/admin/compute` is platform-scope. The `actingOrgId` is irrelevant on this route.                                                                                                                                        |
| Acme org owner tries to set `orgDefaults[acme]` to a platform server that has `sharedWith: []` and is not the global default.                                  | **403/400.** That server is not in `serversVisibleTo(acme)`; the route rejects. Admin must share it first.                                                                                                                                                                                    |
| `instance_admin` revokes Acme's access to a platform server that is currently `orgDefaults[acme]`.                                                             | The override silently falls through. Acme's solves use the global `defaultServerId` until Acme picks a different visible server. (No cascade rewrite — defensive resolver behavior.)                                                                                                          |
| Definition is pinned to a server that the admin later un-shares from the project's org.                                                                        | Pin is ignored at solve time; falls through to `orgDefaults[orgId]` then global default. UI surfaces the stale pin so an editor can clear or re-pick it.                                                                                                                                      |
| Sole `instance_admin` unchecks their own `Instance Admin (all)` checkbox.                                                                                      | **409.** `IPlatformPermissionStore.set` returns `last_admin`; UI mirror disables the checkbox preemptively. Promote another user first, then demote.                                                                                                                                          |
| `instance_admin` deletes the only other user, who also holds `instance_admin`.                                                                                 | Allowed — the actor still holds it. The DELETE handler consults `countInstanceAdminsExcluding(targetId)` first; with the actor still admin, the count is ≥1 and the call proceeds.                                                                                                            |
| Sole `instance_admin` tries to delete or disable themselves.                                                                                                   | **409.** The route handler's `countInstanceAdminsExcluding(self)` returns 0 and surfaces `last_admin` before reaching the auth provider.                                                                                                                                                      |
| `instance_admin` creates a `platform` project and grants Acme org `canSolve = true`.                                                                           | **OK.** All Acme members can view and solve. `canEditDefinition` remains `instance_admin`-only.                                                                                                                                                                                               |
| Acme `member` (org grant `canSolve = false`) tries to solve a `platform` project definition.                                                                   | **403.** View-only grant; `canSolve` requires `grant.canSolve = true`.                                                                                                                                                                                                                        |
| Acme org `admin` tries to Reclaim a `platform` project.                                                                                                        | **403.** `canReclaim` returns false for `platform` visibility.                                                                                                                                                                                                                                |
| `instance_admin` tries to Reclaim a `platform` project.                                                                                                        | **403.** Checked before the management bypass, which would otherwise short-circuit the rule for the one role that can reach such a project.                                                                                                                                                   |

---

## 12. Deferred (tracked, not built)

Designed-for but not implemented. Each can ship later without breaking the model.

- Cross-org guest on a private project
- **Personal scope outside any org** — a scope that belongs to the user, not any org. No org leadership has visibility because no org leadership exists. This is the right home for work a user wants completely to themselves (side projects, drafts not ready for the org, personal tools). Until it ships, private org projects are the closest alternative — they're private from peers and from leadership, but the org owner does have the Reclaim escape hatch. UI would get a scope switcher in the header (`Acting in: Acme / Personal`); the existing `actingOrgId` discipline carries through with a sentinel or parallel `personalScopeId`.
- Project transfer between orgs (UI — data model allows it)
- Audit-log viewer UI. Storage **is** wired in v1: `SupabaseEventSink` persists every domain event to `public.audit_events`. What's deferred is the operator-facing UI for browsing it. The `instance_admin` bypass wrapper is also a hook point for recording cross-tenant admin reads — currently a no-op, lit up when the viewer ships.
- API tokens / service accounts / PATs (distinct from share links — share links are for unauthenticated end-users; PATs are for authenticated programmatic access)
- Webhooks (events emit; dispatcher is later — it slots in as another `IEventSink` alongside the audit sink)
- Per-org data residency / storage backends
- Project templates / bulk member operations (pressure valve for flat ACLs at scale)
- **Multi-tenant SaaS mode** — self-service signup, public org creation, plan/billing, quota enforcement, past-due/read-only state. The data model and the `tenancy: 'multi'` switch already accommodate it; what's deferred is the user-facing flow and the gates around it. When this ships:
  - **Plans are a fourth axis, orthogonal to platform/org/project.** Model them as feature flags + quotas on `Org`, NOT as permissions or roles. Route handlers do `canX(...) && plan.allows('x', currentCount)` — two checks, both must pass. Keeps `rules.ts` free of billing concerns and lets new tiers ship without touching access logic. (§13's "permissions are extensible; roles are not" extends naturally: plan features are extensible; tiers should be too.)
  - **`ALLOW_ORG_COMPUTE_OVERRIDE` becomes per-plan, not platform-wide.** The flag-vs-plan distinction is otherwise the same shape — a feature gate on the org.
  - **The "user has zero orgs" state needs handling.** Today §9 says `actingOrgId` is required at every tenant-touching handler (400 if missing). Fresh SaaS signups legitimately have no orgs yet — those routes need an allowlist (`POST /api/orgs`, profile, logout) and the rest should redirect to a "create or join an org" landing page rather than 400. Mechanical sweep, not architectural.
  - **`/setup` and `/signup` stay separate routes.** `/setup` is staff-seeding: run-once, only reachable while no `instance_admin` exists, grants every platform permission, and in `single` mode also creates the first org. `/signup` is public SaaS account creation: runs forever, creates regular users with no platform permissions, no org side effect — the new user lands on a "create or join an org" page. Keeping them as separate files (not one with branching logic) makes it possible to disable `/signup` per-deployment without touching `/setup`, and keeps the staff-seed path's narrower attack surface obvious.
  - **The OAuth bootstrap path is already gated** on `tenancy === 'single'` (§2) so the first random SaaS signup cannot become Selva staff.
  - **Past-due / read-only state.** Failed payment puts an org in a degraded state — reads still work so customers aren't locked out of their data; writes and solves are blocked. New flag on `Org`, gate at write paths only.

---

## 13. Change discipline

The rules that keep this model from rotting:

1. **Permissions are extensible; roles are not.** Roles are named bundles of permissions — adding a role is a schema migration and UX churn. Adding a permission is cheap. When in doubt, add a permission and map it into the existing roles; don't invent a new role.
2. **No permission inheritance.** Each project carries its own ACL. No cascading from folders, orgs, or templates. Org permissions don't leak into project rules (the old `editor + manage_projects → edit settings` rule violated this and was removed).
3. **A rule that two routes must agree on is a function, not a paragraph.** This is the one the 2026-08 access audit kept re-learning. Almost every real defect it found was a rule that existed correctly in one place and was retyped, slightly differently, in another: the owner-only role gate written out in three routes (two had drifted), the sole-admin lock mirrored client-side from a truncated page, the platform-permission delegation rule copied three times with a comment admitting it. None were subtle logic errors. The test for whether a rule is safe is not "is it correct in every copy today" but **"does breaking it turn one edit into a red test everywhere it applies"** — if the answer is no, the copies will drift, and the drift will be found by an audit rather than by CI.

   Concretely: pure predicates go in [`rules.ts`](../../platform/src/access/rules.ts), the loading of their inputs goes in `access.server.ts`, and routes call the guard. UI that gates on a server rule receives the **answer** from its loader rather than recomputing the rule client-side.

When in doubt: **flat, explicit, and one concept per scope.**
