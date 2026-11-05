# Access Control: Selva

The single source of truth for who can do what.

---

## 1. Mental model

Three scopes of authority, from broadest to narrowest:

| Scope        | Who it applies to              | What it answers                                         |
| ------------ | ------------------------------ | ------------------------------------------------------- |
| **Platform** | The entire Selva instance      | "Can you administer the instance itself?"               |
| **Org**      | A single organization (tenant) | "Which tenant's data can you touch, and how much?"      |
| **Project**  | A single project inside an org | "In this project, are you a contributor or a consumer?" |

**Org is the hard tenancy boundary.** Two things cross it: `public` projects when `ALLOW_CROSS_ORG_PUBLIC` is on (§4), and `platform` projects through grants (§4a).

A user can belong to multiple orgs. Their permissions in one org are independent of another: Alice can be `admin` in Acme and `member` in BigClient.

Every incoming request carries an **acting org context** (`RequestContext.actingOrgId`). Tenancy checks compare `ctx.actingOrgId` to the resource's `orgId`, never "is the user a member of some org that matches." This prevents cross-org leaks when a user belongs to several orgs.

Platform flags (`ALLOW_CROSS_ORG_PUBLIC`, `ALLOW_ORG_COMPUTE_OVERRIDE`, `ENABLE_SHARING`, `ENABLE_PLATFORM_PROJECTS`, all default off) are set as `SELVA_FLAG_<NAME>` in the environment. This doc uses the bare names.

---

## 2. Platform scope

Five permissions, all instance-wide. There is no platform role.

| Permission              | What it grants                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instance_admin`        | Superuser. Implies every other permission, for management actions only (see "does not bypass content access" below).                                                                                                                                                                                    |
| `manage_compute`        | Manage platform compute servers: create/edit/delete, set each server's per-org sharing (`sharedWith`), set the global `defaultServerId`, run operational actions against a server. See §3.                                                                                                              |
| `manage_instance_users` | List, create, disable and delete users. Disable is one way: there is no enable endpoint. Granting or changing platform-scope permissions, and disabling or deleting an `instance_admin`, need `instance_admin` too.                                                                                     |
| `manage_updates`        | See the `/admin/system` panel and switch the release channel. **Running** an update needs `instance_admin` (`POST /api/admin/system/update`). The panel shows the Update runner to `manage_updates` holders anyway, so for them the run returns 403. That is a UI inconsistency; the route is the rule. |
| `manage_api_tokens`     | Mint any API token for yourself. A key that only reads and uploads needs only `canCreateDefinition` somewhere in the org instead (§8). A host's `mayHoldApiTokens` replaces both. The one platform permission meant for ordinary users: it does not admit you to `/admin`.                              |

**Invariant: at least one user holds `instance_admin`.** Revoking it, deleting the holder, or disabling the holder is refused (`last_admin`, 409) when it would leave none. `IPlatformPermissionStore.set()` enforces revocation. Delete and disable are checked by the route through `countInstanceAdminsExcluding(targetId)` before it calls the auth provider, which knows nothing about Selva permissions. The admin UI disables the control on the sole admin.

**Both ends of the invariant are atomic, and have to be.** A `count`-then-`update` lets two concurrent demotions each see the other as the survivor, and both commit. Supabase does check and write in one RPC, `selva.set_platform_permissions`, which locks the target row and then the surviving admins `for update`. A single statement with an `exists` subquery is not enough: under READ COMMITTED the subquery reads the statement's opening snapshot, so every concurrent demotion still sees the others as live. Local serializes through a mutex in `LocalUserDataStore.updatePermissionsGuarded`, which covers one process, the same boundary its load-once cache draws. **A caller that counts and then calls `set` reintroduces the race.** `claimFirstInstanceAdmin` is the mirror case: it grants only if no admin exists and re-checks under a lock, because read-then-write let two simultaneous first sign-ins both become permanent admins.

**Disabled admins do not count as live.** The local permission store reads `user-data.json` and cannot see the disabled flag, which lives in the auth provider's file, so `disableUser` revokes `instance_admin` before setting the flag. Supabase filters `disabled = false` in SQL. With no enable endpoint the grant is never restored, and a disabled user cannot be granted `instance_admin`.

**`instance_admin` does not bypass content access.** The bypass (§5) covers management actions: user administration, org management, compute config, project governance (create, delete, manage members, Reclaim). It does **not** cover `canView`, `canSolve`, `canEdit` or `canEditDefinition`. Platform staff who need a specific private project must Reclaim it first, which leaves an audit trail. This is deliberate (least privilege, GDPR, SOC 2): blanket content access enlarges the blast radius of a compromised admin account and is hard to justify in a data audit. The API layer enforces the boundary; raw database or filesystem access is a separate physical-security concern.

**Break-glass recovery.** If the invariant is bypassed by non-runtime means (manual DB edits, restoring an old backup, migration drift), set `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` and have that user sign in through an identity-provider callback (OAuth, email link, or the forward-proxy path). The callback grants every platform permission iff no admin exists _and_ the email matches. The local password provider has no such path, because it never goes through a callback. Its grants live in the `platformPermissions` field of `user-data.json` (`auth-users.json` holds identity only), so recovery means editing that field with the process stopped. `/setup` does not help: it only opens while no `instance_admin` row exists.

**Deployment modes** are selected by `tenancy` in [`config.ts`](../../packages/platform/src/config.ts) (`'single' | 'multi'`):

- **Self-hosted / single-tenant** (`tenancy: 'single'`). One org, provisioned by `/setup` or seeded on the first admin's sign-in. The `instance_admin` is typically also the org owner; the UI merges the two views. **Bootstrap is open by default:** without `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, the first sign-in through any identity-provider callback wins, exactly one even if several arrive at once (`claimFirstInstanceAdmin`). Setting the variable restricts it to a named operator, the right default for anything reachable from the internet. The `/setup` password form follows the same rule: with the variable set only that email may claim the instance; without it, whoever reaches `/setup` first wins, so finish it before the host is reachable.
- **Multi-tenant / SaaS** (`tenancy: 'multi'`). Many orgs coexist. `instance_admin` is Selva-staff-only; customers, even owners of the largest tenant, never hold it. **Bootstrap is closed by default:** the callback grants only when `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is set and matches the signer. Without that gate the first random signup would become Selva staff. The variable is safe to leave set: the path is inert once an admin exists. Self-service org creation, plan/billing and quota gating are deferred (§12).

---

## 3. Org scope

### Roles

| Role     | Default permissions                                                  |
| -------- | -------------------------------------------------------------------- |
| `owner`  | All four org permissions.                                            |
| `admin`  | All four org permissions.                                            |
| `member` | None by default. Grantable: `manage_definitions`, `manage_projects`. |

> **Owner vs admin in practice.** The roles share every permission. The difference is that **only an `owner` can change roles** (promote a `member` to `admin`, demote an `admin` or owner) **or remove an owner** (§5 `canChangeOrgRole`). An owner can be demoted or removed only by another owner, and never the last one (409). Ownership transfer is not built (`/team/settings` shows a disabled button), so handing an org over means promoting a second owner. Treat **owner as the role that cannot lock itself out**, and **admin as the role you grant freely**.
>
> **A role change resets permissions to the new role's defaults; custom grants do not survive it.** `updateOrgMemberRole` writes `DEFAULT_ORG_PERMISSIONS[role]` over whatever was there, in both providers. Promoting a `member` who held `manage_projects` to `admin` gives all four, and demoting them back leaves **none**. This is deliberate: the role is the coarse statement of standing and the permission array refines it, so a demoted admin must not silently keep authority their new role does not imply. The cost is that a deliberate custom grant is lost to an unrelated role change. Re-grant through the `permissions` branch of the members PATCH.
>
> **Admins do not see all projects in the org.** Org role grants no project visibility. An admin sees only projects they belong to, plus `org`/`public` ones (§4). The escape hatch is `canReclaim` (§5), which is auditable and adds the admin as a co-owner, so org role never silently bypasses project ACLs (§13 rule 2).

### Permissions

| Permission           | What it grants                                                                                                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manage_org_members` | Invite and remove members; grant/revoke the grantable permissions (`manage_definitions`, `manage_projects`). Owner/admin only: never grantable to `member`. **Does not include role changes**: promoting, demoting and ownership changes are owner-only, through one rule (`canChangeOrgRole`, §5).               |
| `manage_definitions` | Upload/edit definitions in this org (further gated by project role).                                                                                                                                                                                                                                              |
| `manage_projects`    | Create projects in this org. (Editing/deleting is gated by project role.)                                                                                                                                                                                                                                         |
| `manage_org_compute` | Create/edit/delete this org's own compute servers (`scope: 'org'`) and set `orgDefaults[orgId]`. Owner/admin only. Gated by `ALLOW_ORG_COMPUTE_OVERRIDE`, but only at the org compute API (403) and the `/team/compute` controls. With the flag off, org-private rows that already exist still resolve in solves. |

> **`manage_compute` stays at platform scope.** `manage_org_compute` only grants authority over the org's own servers and default selection, never platform servers.

### Invites

Invites are org-scoped: you invite a user to an org, never to a project. Project membership is managed inside the org (§5). Cross-org project guests are deferred (§12).

### Compute (servers, sharing, defaults)

A compute server belongs to exactly one scope:

- **Platform server** (`scope: 'platform'`), created with `manage_compute`. `sharedWith: 'all' | string[]` controls which orgs see it. `'all'` is the default in `tenancy: 'single'`; in `'multi'` admins assign explicitly.
- **Org-private server** (`scope: 'org'`, `ownerOrgId`), created with `manage_org_compute`. Visible only to that org.

**Defaults are layered**, and both are optional:

- **`defaultServerId`** (global, `manage_compute`). Must reference a platform server. **Usable by every org regardless of `sharedWith`**: it is the floor of the system.
- **`orgDefaults[orgId]`** (per-org, `manage_org_compute`). Must reference a server visible to that org, so it only matters when the org has more than the global default to choose from.

A platform server with `sharedWith: []` that is not the global default is **dormant**: admin-only, unusable for solves.

**Visibility** (`serversVisibleTo`, used by every picker and the resolver): platform servers that are the global default, are shared with `'all'`, or list the org; plus the org's own servers. The flag is not consulted here.

**Resolution** (`resolveServerForOrg`, pure, narrowest wins):

1. The definition's `computeServerId` pin, if the server is visible to the project's org. A pin to a server that is no longer visible falls through, since an admin may have un-shared it since.
2. `orgDefaults[project.orgId]`, if set and visible.
3. The global `defaultServerId`.
4. The first visible server (mainly before a default is chosen).

Nothing rewrites stored pins or org defaults when a server is un-shared. The resolver falls through, and the UI surfaces a stale pin. An org misconfiguring its own server affects only its own solves. Platform-server administration belongs only to `manage_compute` holders; org admins cannot touch it.

---

## 4. Project scope

### Roles

| Role     | Can view/solve | Can edit definitions | Can manage project |
| -------- | :------------: | :------------------: | :----------------: |
| `owner`  |       ✅       |          ✅          |         ✅         |
| `editor` |       ✅       |          ✅          |         ❌         |
| `viewer` |       ✅       |          ❌          |         ❌         |

`viewer` exists for clients, stakeholders and auditors: they see schemas, submit solves and download results, but cannot modify the definition.

**Platform projects have no members.** `instance_admin` is the implicit owner; grants (§4a) deliver view/solve to external parties without membership rows.

### Visibility

| Visibility | Who can view/solve                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `private`  | Project members only (explicit owner/editor/viewer role).                                                                                   |
| `org`      | Any member of the parent org, with that org as the acting org.                                                                              |
| `public`   | With `ALLOW_CROSS_ORG_PUBLIC` on: any authenticated user on the instance. With it off: members of the parent org only.                      |
| `platform` | `instance_admin` plus explicit grant holders (§4a). Denied to everyone, `instance_admin` included, while `ENABLE_PLATFORM_PROJECTS` is off. |

A project member sees the project at any non-`platform` visibility. Leaving the org ends the membership, so this reaches beyond the org only for someone who reclaimed.

**Default for new projects: `private`.** Anonymous access is not a project flag: it comes from per-definition **share links** (§7). There is no "anonymously solvable project" mode.

**`private` means private, full stop,** including from org leadership. A member's personal R&D or a project they don't want their manager to see yet are valid reasons, and org `admin`/`owner` role grants no access to them. Leadership's escape hatch is **Reclaim** (§5 `canReclaim`), an explicit, auditable step that adds them as co-owner. That audit trail is the load-bearing protection: the cost of "I need to access this" is one intentional action, not a silent default.

### Project members must be org members

A user must belong to the project's parent org before becoming a project member. This is enforced in the **rule layer**, not as a DB constraint, to leave room for cross-org identities (guests, service accounts) without a schema migration.

### The two project models

`autoJoinOnUpload` (default `false`, settable only on `public` projects, rejected on `platform` ones by `validateProjectFlags`) selects the authority model per project.

**Project-as-container** (`false`), for company workflows, client deliverables and internal tools. Project role is authoritative: only `owner`/`editor` upload or edit, and definition ownership is display metadata.

**Project-as-commons** (`true`), for user-generated content and shared libraries.

- Anyone who passes `canView` can upload a **new** definition and becomes its _definition owner_, not a project member. With `ALLOW_CROSS_ORG_PUBLIC` off, that means members of the project's org only. No project role is granted.
- A definition owner can edit and delete their own definitions while they remain a member of the project's org, and nobody else's.
- Project `owner`/`editor` can still edit anyone's definition (moderation).

On a commons project Peter cannot upload a new version of Alice's definition, but can upload and edit his own.

**Commons grants edit on top of belonging, not instead of it.** `canEditDefinition` requires a live org membership alongside `ownerId`, because `ownerId` records who uploaded and is never revisited. Without that test, removing someone from the org would leave their edit, delete and share-link authority over everything they uploaded, and offboarding would not be offboarding. A commons project therefore cannot serve as an anonymous drop-box for people outside the org.

**Flipping `autoJoinOnUpload` false → true is retroactive:** every existing definition falls under the commons contract at once, with its uploader as definition owner. With the membership test, the flip re-grants edit only to uploaders still in the org.

---

## 4a. Platform-admin projects

A project with `visibility = 'platform'` is owned and operated only by `instance_admin`. External orgs or users get **view/solve** through explicit grants, never edit or manage.

**Why a visibility level and not a role:** no membership rows are needed, grants are a narrow auditable entitlement with no org-membership side effects, and a new role would be a schema migration (§13 rule 1).

- Only `instance_admin` creates, updates, deletes and uploads definitions to a `platform` project, and manages its grants (`/api/admin/projects/*`, §8).
- It lives inside a real org that supplies tenancy for storage routing and compute resolution, but membership of that org grants **no** access: the visibility type governs everything.
- A grant is `{ granteeType: 'org' | 'user', granteeId, canSolve }`. An org grant matches anyone **acting in** that org (`ctx.actingOrgId`), so it covers current and future members with no per-user expansion. A user grant follows that user into any org.
- Revoking deletes the grant (hard delete): revocation is immediate and nothing references a grant.
- `canSolve` is strictly narrower than `canView`: a view-only grant holder can fetch the schema but cannot submit solves.
- `canEdit`, `canEditDefinition`, `canManage` and `canEditProjectSettings` all require `instance_admin`. For platform projects admin status **is** the rule, not the §5 content/management bypass split.
- **With `ENABLE_PLATFORM_PROJECTS` off, every rule denies a platform project, `instance_admin` included,** and the management bypass is withheld too. Existing rows are preserved; turning the flag back on restores them.

> **No Reclaim on platform projects.** Reclaim is an org-leadership escape hatch for org-owned projects whose owner left. Platform projects have no org ownership to reclaim. `canReclaim` returns `false` for them.

---

## 5. Rules

The pure access-control functions live in [rules.ts](../../packages/platform/src/access/rules.ts): already-resolved rows in, boolean out. Adapters do the lookup, rules do the logic. Every gate (adapter `can*` methods, route-layer `require*` helpers) funnels through them, and the route layer pre-loads only the rows a rule needs. The rule bodies are not repeated here; this section records what each rule is for and the traps around it.

### The `instance_admin` bypass is split: management yes, content no

[`guards.ts`](../../packages/server/src/access/guards.ts) wraps the rules in two ways:

- **`managementBypassOrRun`** for governance: Reclaim, create or delete a project, manage project members, edit project settings, make a project public. `instance_admin` passes, so platform staff can administer the instance without joining every org.
- **`contentCheck`** for `canView`, `canSolve`, `canEdit` and `canEditDefinition`. **No bypass.** If staff need content in a private project, they Reclaim first, so the audit trail attaches to an explicit escalation.

The rules reason about normal users only. A rule bug does not become a bug in god-mode, and the split makes the security boundary reviewable in one place.

### Share-link grants are a parallel path

A valid share-link token (§7) grants **one (definitionId, channel) pair**, whatever the project's visibility or membership. Token resolution runs before the user rules, and when a valid token resolves those rules are skipped.

### Rule notes

- **`canView` / `canSolve`.** Visibility semantics are in §4. `canSolve` is a separate function whose body is `canView` for non-platform projects, so future solve-gating (quotas, rate limits, compute budgets) has a home without touching every call site. Authorization and cost are different concerns. For platform projects `canView` accepts any grant holder and `canSolve` needs `grant.canSolve`.
- **`canEdit`.** Project `owner`/`editor`. The project-level gate for filtering the project list and for new-definition uploads on container projects. Distinct from `canEditDefinition` (adds the commons owner branch) and `canEditProjectSettings`.
- **`canCreateDefinition`.** Container projects: `canEdit`. Commons projects: anyone who passes `canView`. The rule is pure: the _handler_ stamps `ownerId = uploader` on a new definition, and the uploader does not become a project member.
- **`canEditDefinition(project, definition, user)`.** Takes the definition because commons ownership is per definition; in container mode it is never consulted. Project `owner`/`editor` always pass (moderation). On a commons project the definition's owner passes while still in the project's org.
- **`canManage` and `canEditProjectSettings`.** Project `owner` only. Settings are owner-only because letting an `editor` with org `manage_projects` edit them would leak org permission into project authority (§13 rule 2) and make "why can this editor change settings and that one can't" non-local. Promote the editor to owner instead.
- **`canCreateProject`.** `ctx.actingOrgId` must equal the org, and the user is org `owner`/`admin`, or a `member` with `manage_projects`. The creator becomes project `owner`.
- **`canChangeVisibilityToPublic`.** Org `owner`/`admin`, because flipping **to** `public` is a disclosure. The `ALLOW_CROSS_ORG_PUBLIC` flag does **not** gate the flip; it only changes what `public` means afterwards (`canView`, §4). Self-hosted single-tenant instances can leave the flag off and still flip. `instance_admin` passes through the management bypass.

**`private → org` is deliberately ungated.** Only the flip to `public` consults the rule. A project owner who is a plain org `member` can move their own project to `org` on their own authority: `org` exposes it inside the tenant that already owns it, so the disclosure boundary is not crossed, and gating it would stop a member sharing their own work with colleagues without asking leadership. Worth revisiting only if orgs grow large enough that "everyone in the org" stops being a meaningful trust boundary.

### `checkOwnerRemoval(target, allMembers, confirmed) → 'ok' | 'sole_owner' | 'needs_confirm'`

Pre-flight for the project-members route, run after `canManage`, on both DELETE and PATCH demotion. Without the PATCH guard a sole owner could demote themselves to `viewer` and lock the project, because `canManage`, `canEditProjectSettings` and `canEdit` all go false at once.

- Target is not an owner → `ok`.
- Sole owner → `sole_owner` (409, suggests Reclaim). There is no confirmation: no state exists that the caller could confirm into.
- Owner-on-owner without `?confirm=true` → `needs_confirm` (409). With it, proceeds when at least two owners exist before the change.

Pure over loaded rows, so behavior is identical across providers.

### `canChangeOrgRole(actorMember, role) → bool`: the owner boundary

Whether the actor may hand out or take away org `owner`/`admin` standing (§3). `role === 'member'` → yes (ordinary member management is what `manage_org_members` is for). Otherwise the actor's membership row must be `owner`.

**Four handlers decide this and all call this function:** invite mint, invite resend, member PATCH (role and permission branches) and member DELETE. Hand-written copies drift. A copy that misses a path lets an admin mint themselves an `owner` invite, or remove an owner that PATCH refuses to demote. Removal is gated like demotion because it is the harder one to undo: a demoted owner can be re-promoted, a removed one has lost every project membership to the cascade.

Role _changes_ are gated on both ends (the role granted and the one taken away), because demoting an owner crosses the boundary even though `member` does not. The rule reads the actor's **membership row**, never `Organization.ownerId`: the two can disagree and only the row is authority.

### `canReclaim(project, user, ctx) → bool`: org owner/admin escape hatch

Org leadership can reclaim any project in their org, for example when the original owner left. `ctx.actingOrgId` must equal `project.orgId`, and the user must be org `owner` or `admin`. Platform projects can never be reclaimed.

**The platform-project refusal runs ahead of the management bypass,** in `requireCanReclaim` rather than inside the rule. `managementBypassOrRun` short-circuits for `instance_admin`, the only role that can reach a platform project, so a refusal living only in the rule would never execute. Reclaim is content escalation wearing management clothing, and the bypass is not its to inherit.

**Reclaim adds the actor as a co-owner** and does not demote the existing owner, which preserves the original owner's access if they return.

**Reclaim emits `project.reclaimed`** with `projectId`, `orgId`, `actorId` and `priorVisibility`. `addProjectMember` also emits `project_member.added`, but that is indistinguishable from an owner adding a teammate, and §4 rests the whole escape hatch on the escalation being visible afterwards. `priorVisibility` is recorded because a later visibility flip would otherwise rewrite how serious the entry looks.

---

## 6. Definition versioning

Every definition has **immutable versions** and **named channels** pointing at versions. `Definition.liveVersionId` is the published version (what external consumers solve); `Definition.draftVersionId` is the latest upload (what editors test). `fileExt` and `originalFilename` live on the version, not the definition, since versions can differ in both.

| Channel | Points to        | Who can solve it                                                                                                                                 |
| ------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `live`  | `liveVersionId`  | Anyone who passes `canSolve` for the project.                                                                                                    |
| `draft` | `draftVersionId` | Whoever passes `canEditDefinition`: project `owner`/`editor`, or on a commons project the definition's own owner while still an org member (§4). |

**Flow.** Alice uploads `scheme.gh` → `v1`, both channels on `v1`. She re-uploads → `v2`; `draft` advances, **`live` stays on `v1`**. She tests `v2` at `/library/[guid]?channel=draft`, then clicks **Publish** → `live` advances to `v2`.

**Rollback** is first-class: `live` can be re-pointed at any prior version at any time, with no re-upload. Required for "we shipped something broken, revert now."

**Deletion protection.** A `DefinitionVersion` cannot be deleted while `liveVersionId` or `draftVersionId` references it. The data layer enforces this (`ON DELETE RESTRICT` in Postgres, an explicit check in the local provider), so a buggy handler cannot orphan a pointer.

Embedded consumers never break from an upstream edit, and upload plus publish is one action for basic use. Versioning applies to all definitions regardless of project visibility.

---

## 7. Share links

Per-definition tokens that grant access to one definition and channel **without an account**. One mechanism covers sharing a draft for review and embedding a definition in a public iframe. `ENABLE_SHARING` gates minting, listing, revoking and token resolution: with it off, every token on the wire stops working without being revoked.

### Why this shape

- **Definition-scoped, not project-scoped.** A token pins one `(definitionId, channel)`. A leaked link exposes one definition, and definitions added later are not auto-included.
- **Parallel grant system.** Tokens never change `Project.visibility` or membership. A private project can have share links.
- **Explicit opt-in per link.** Every link is minted individually by someone who passes `canEditDefinition` (the rule that gates uploads), and the same authority revokes it.
- **Token leakage is the design assumption.** Anyone viewing an iframe sees the token, so per-link caps and revocation are the load-bearing protections, not secrecy.

A link stores `tokenHash` (HMAC of the raw token; the raw value is shown once at mint), `channel`, optional `expiresAt`, `revokedAt` (revocation is a soft delete), `allowSolve` (false = schema fetch only), `maxSolves` and an atomic `solveCount`. New links default to `maxSolves = 1000`; the minter can raise or remove it explicitly. An uncapped token in an iframe with no expiry is a denial-of-wallet vector.

### Token resolution

Tokens (`?token=…` or `Authorization: Bearer …`) are honoured in exactly two places: `POST /api/v1/compute` (either channel) and the `/library/[guid]` page (**live channel only**; draft and explicit-version views there need edit rights on a session). `POST /api/v1/definitions/[guid]/solve` takes no token and must never grow one.

1. A value not shaped like a share token is ignored and the request falls through to session auth.
2. A well-formed token that fails is refused outright, not retried as a session: unknown, revoked, expired or target gone → 401; wrong definition or channel (strict equality), or view-only on a solve → 403.
3. On success the request runs with a synthetic `RequestContext`: no user identity, `actingOrgId` = the project's org, no platform or org permissions. `canSolve`/`canView` are skipped: the token is the authorization.
4. On a solve, `solveCount` is checked and incremented atomically; at the cap the route returns 429. The cap is enforced **here**, not at resolution, because a check at resolution would race with concurrent solves. Postgres does one `UPDATE … WHERE max_solves IS NULL OR solve_count < max_solves RETURNING …`; Local serializes with a lock, enough for one process. With that guard a cap of N allows N solves.

### Cascade

- Definition soft-deleted → tokens fail closed. Hard-deleted → the link cascades out with it. Project deleted → cascades through the definition.
- Removing the minter from the org, or disabling them, leaves their links live on purpose (§10).
- **Hard-deleting the minter's account deletes the links they minted,** on both providers (`created_by` cascade in Postgres, `eraseUser` in Local).

### Not built, on purpose

- **JWT.** Opaque tokens plus a DB lookup suffice; JWT only helps stateless validation, and every check hits the DB anyway (revocation, counter).
- **Per-version pinning.** Tokens follow the channel pointer, so publishing v3 means existing live tokens serve v3, the same semantics as rollback. Add a `versionId` field if "always serve v2" becomes a real need.
- **Origin/Referer allowlist.** Easy to bypass server-side and gives false security. Caps and revocation carry the load.
- **Project-scoped tokens.** Share five definitions by minting five links: explicit, and revocable separately.

---

## 8. API route matrix

Maps HTTP routes to rule checks. **Every shipped route appears here,** enforced by `api/v1/__tests__/conformance.test.ts`, which walks `routes/api/**` and fails on any handler this table does not list: an unlisted route is an authorization decision nobody reviewed. Rows for endpoints that are not built yet are fine and say so.

`instance_admin` passes rows gated on **management** scope via the centralized bypass (§5). It does **not** pass content rows (`canView`, `canSolve`, `canEdit`, `canEditDefinition`); Reclaim is the auditable escalation, and `canReclaim`'s platform-project refusal is checked ahead of the bypass for the same reason.

**CSRF.** SvelteKit's own `csrf.checkOrigin` is turned off (`trustedOrigins: ['*']`); Selva runs `server/src/http/csrf.ts` from `hooks.server.ts` instead. It rejects cross-origin unsafe-method requests with form content types and skips them for a Selva API key in `Authorization` and for a few exempt paths (the OAuth token endpoint). `application/json` requests are not Origin-checked, so the JSON API relies on the session cookie's `SameSite` attribute. A stricter check would break cross-origin API clients, which authenticate with a token, not a cookie. The consequence: **a same-origin XSS can call any authenticated endpoint.** Selva sets no CSP `script-src` (a strict one would break embedding, so `applySecurityHeaders` sets only `frame-ancestors`, per route), which leaves nothing in front of that.

### Content API (`/api/*`)

| Route                                                    | Method        | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/projects`                                       | `GET`         | Authenticated. The caller's `canView` project set (`resolveAccessibleProjects`); org `owner`/`admin` is **not** a substitute for project membership. Each item's `canCreateDefinitions` is `canCreateDefinition` and, for an API token, its org-wide `upload` scope.                                                                                                                                                                                                                                       |
| `/api/v1/projects`                                       | `POST`        | `canCreateProject(targetOrg, user, ctx)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/api/v1/projects/[id]`                                  | `GET`         | `canView(project, user, ctx)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/api/v1/projects/[id]`                                  | `PATCH`       | `canEditProjectSettings`. Visibility → `public` also needs `canChangeVisibilityToPublic`; → `platform` needs `instance_admin`.                                                                                                                                                                                                                                                                                                                                                                             |
| `/api/v1/projects/[id]`                                  | `DELETE`      | `canManage(project, user)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/api/v1/projects/[id]/reclaim`                          | `POST`        | `canReclaim(project, user, ctx)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/api/v1/projects/[id]/members`                          | `GET/POST`    | `canManage(project, user)`. Target must be an org member (rule layer).                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/api/v1/projects/[id]/members/[userId]`                 | `PATCH`       | `canManage(project, user)`. Demoting an owner runs the same `checkOwnerRemoval` guard as DELETE.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/api/v1/projects/[id]/members/[userId]`                 | `DELETE`      | `canManage(project, user)`. Sole-owner removal blocked; owner-on-owner needs `?confirm=true`.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/api/v1/definitions`                                    | `GET`         | Authenticated. Definitions across the caller's `canView` project set (`resolveAccessibleProjects`), never an unfiltered store read. `?documentId=` narrows to definitions from that Grasshopper document the caller passes `canEditDefinition` on, plus the key's `upload` scope for a token.                                                                                                                                                                                                              |
| `/api/v1/definitions`                                    | `POST`        | **Create new definition.** `canCreateDefinition`: container mode needs project `owner`/`editor`; commons mode takes anyone who passes `canView`, and the handler sets `ownerId = user.id`. Scope `upload`.                                                                                                                                                                                                                                                                                                 |
| `/api/v1/definitions/[guid]`                             | `GET`         | `canView` via `getVisibleDefinition`: **404, never 403,** on a guid the caller cannot see. `canEdit` in the body is `canEditDefinition` plus, for a token, its `upload` scope on the definition.                                                                                                                                                                                                                                                                                                           |
| `/api/v1/definitions/[guid]/schema`                      | `GET`         | `canView` via `getVisibleDefinition` + `loadVisibleVersion` on the `live` channel. Same 404-not-403 contract.                                                                                                                                                                                                                                                                                                                                                                                              |
| `/api/v1/definitions/[guid]/versions`                    | `POST`        | **New version of existing definition.** `canEditDefinition`. Creates a `DefinitionVersion`; advances `draft`. Scope `upload`.                                                                                                                                                                                                                                                                                                                                                                              |
| `/api/v1/definitions/[guid]`                             | `PATCH`       | `canEditDefinition` (metadata only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/api/v1/definitions/[guid]`                             | `DELETE`      | `canEditDefinition`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/api/v1/definitions/[guid]/image`                       | `POST`        | `canEditDefinition`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/api/v1/definitions/[guid]/publish`                     | `POST`        | `canEditDefinition`. Body `{ versionId? }`; advances `live` to the current `draft` or any prior version (rollback). Scope `upload`.                                                                                                                                                                                                                                                                                                                                                                        |
| `/api/v1/definitions/[guid]/versions`                    | `GET`         | `canView` via `getVisibleDefinition`: an invisible guid **404s, never 403s,** like its siblings. Answering "forbidden" for a guid the caller cannot see makes the route a cross-tenant existence oracle.                                                                                                                                                                                                                                                                                                   |
| `/api/v1/definitions/[guid]/versions/[versionId]`        | `GET`         | `canView` via `loadVisibleVersion`, which re-checks `version.definitionId === guid` so a valid version id under someone else's guid is not an IDOR.                                                                                                                                                                                                                                                                                                                                                        |
| `/api/v1/definitions/[guid]/versions/[versionId]/schema` | `GET`         | `canView` via `loadVisibleVersion`. Same guid/version pairing check.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/api/v1/definitions/[guid]/versions/[versionId]`        | `DELETE`      | `canEditDefinition`. §6 deletion protection: 409 if referenced by `liveVersionId`/`draftVersionId`.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/api/v1/definitions/[guid]/share-links`                 | `GET/POST`    | `canEditDefinition`. POST returns the raw token once. 404 while `ENABLE_SHARING` is off.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/api/v1/definitions/[guid]/share-links/[linkId]`        | `DELETE`      | `canEditDefinition`. Soft-delete (sets `revokedAt`). 404 while `ENABLE_SHARING` is off.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/api/v1/compute`                                        | `POST`        | **The URL-addressed solve,** taking an arbitrary `definitionUrl`. `canSolve(project, user, ctx)`. Channel `live` (default) or `draft`; `draft` needs `canEditDefinition`. **One of two places that accept a share token** (§7): a valid `?token=…` bypasses user auth and grants the token's pinned scope only.                                                                                                                                                                                            |
| `/api/v1/definitions/[guid]/solve`                       | `POST`        | The definition-addressed solve. Same `canSolve` gate, authenticated users only: no share-token branch, and it must never grow one. `definitionUrl` must equal `local:{guid}` or be omitted.                                                                                                                                                                                                                                                                                                                |
| `/api/v1/solve-events`                                   | `GET`         | Signed-in users only (share-link viewers get no stream). Opens the tab's SSE stream under `user:{id}`; an id another user holds is refused (409). A solve reports here only when its caller owns the stream.                                                                                                                                                                                                                                                                                               |
| `/api/v1/solve-events/[solveId]`                         | `POST`        | No session: the bearer is the per-solve HMAC token `runSolve` minted for this `solveId`, held only by the plugin inside that Compute solve. 410 once the solve is closed.                                                                                                                                                                                                                                                                                                                                  |
| `/api/v1/solve/[solveId]/cancel`                         | `POST`        | Signed-in users only, and only the owner of the stream the solve reports to. Sets the abort flag the plugin reads on its next callback.                                                                                                                                                                                                                                                                                                                                                                    |
| `/api/v1/compute/schema`                                 | `POST`        | `requireCanCreateDefinition(projectId)`, the gate for creating a definition. The target project's `orgId` selects BYO compute. Previews a user-supplied .gh file's schema in the upload dialog. Scope `upload`.                                                                                                                                                                                                                                                                                            |
| `/api/v1/orgs/[orgId]/compute`                           | `GET/PATCH`   | `manage_org_compute`, gated by `ALLOW_ORG_COMPUTE_OVERRIDE` (403 when off). URL `orgId` must equal `ctx.actingOrgId` (403 otherwise).                                                                                                                                                                                                                                                                                                                                                                      |
| `/api/v1/orgs/[orgId]/assets/[kind]`                     | `POST/DELETE` | `manage_org_members`: org branding is an org-admin action, not a platform one. URL `orgId` must equal `ctx.actingOrgId`.                                                                                                                                                                                                                                                                                                                                                                                   |
| `/api/v1/orgs/[orgId]/members/[userId]`                  | `PATCH`       | Body `{ role?, permissions? }`. URL `orgId` must equal `ctx.actingOrgId`. The role branch is `canChangeOrgRole` (§5) on both the new and the old role. The permission branch is `manage_org_members` plus `canChangeOrgRole` on the target's role, since emptying an owner's or admin's set demotes them in all but name. Every check runs before any write. Cannot demote the sole owner (409). For `member` targets, `permissions` is limited to `MEMBER_ASSIGNABLE_PERMISSIONS`.                        |
| `/api/v1/orgs/[orgId]/members/[userId]`                  | `DELETE`      | `manage_org_members` + `canChangeOrgRole` on the target's role: removing an owner is owner-only. Cannot remove the sole owner (409). Cascades `project_members`, revokes pending invites for the same email, and emits `org_member.removed_orphaning_projects` for any project left ownerless (§10).                                                                                                                                                                                                       |
| `/api/v1/orgs/[orgId]/members`                           | `GET`         | **Any member of the acting org** (`requireActingOrg` only): the roster is what the team page renders. It returns each member's `permissions` to every colleague, not just leadership.                                                                                                                                                                                                                                                                                                                      |
| `/api/v1/orgs/[orgId]/invites`                           | `GET/POST`    | `manage_org_members`, session only: an accepted invite is an account that outlives a leaked key. URL `orgId` must equal `ctx.actingOrgId` (403 otherwise). POST also runs `canChangeOrgRole` on the invited role: an invite is a second door into `org_members`.                                                                                                                                                                                                                                           |
| `/api/v1/orgs/[orgId]/invites/[id]`                      | `DELETE`      | `manage_org_members`. Same tenancy check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/api/v1/orgs/[orgId]/tokens`                            | `GET/POST`    | Session only: an API token is refused (403). URL `orgId` must equal `ctx.actingOrgId`. GET lists the caller's own tokens; `?all=true` lists everyone's and needs `manage_org_members`. POST mints as the caller, refuses scopes outside the org or the caller's sight, and needs `canHoldApiTokens` for the requested scopes: `manage_api_tokens` for any key, or `canCreateDefinition` in one project of the org for a key that only reads and uploads, or the host's `mayHoldApiTokens` instead of both. |
| `/api/v1/orgs/[orgId]/tokens/[tokenId]`                  | `DELETE`      | Session only. The owner revokes their own; `manage_org_members` revokes anyone's in the org. A token the caller may not revoke reads as 404.                                                                                                                                                                                                                                                                                                                                                               |
| `/api/v1/orgs/[orgId]/invites/[id]/resend`               | `POST`        | `manage_org_members`, session only, same tenancy check. Mints a replacement and revokes the original, so the superseded link stops working. Grants are copied from the original rather than re-derived, so a since-demoted admin can't alter what the invite carries. The resender still passes `canChangeOrgRole` on the invite's role and the platform-permission gate, because the response hands them a working link. 409 once accepted.                                                               |
| `/api/v1/orgs/[orgId]`                                   | `GET`         | Any member of the acting org (`requireActingOrg` only). URL `orgId` must equal `ctx.actingOrgId` (403 otherwise).                                                                                                                                                                                                                                                                                                                                                                                          |
| `/api/v1/openapi.json`                                   | `GET`         | Public. The spec describes the API, not tenant data; same content as `/docs/api/openapi.yaml`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/api/v1/me`                                             | `GET`         | Authenticated. Returns the caller's own identity and resolved context; reads `locals.user` and nothing else.                                                                                                                                                                                                                                                                                                                                                                                               |
| `/api/v1/me/token`                                       | `DELETE`      | API token only; a session gets 400. Revokes the key that sent it (reason `owner`) and nothing else. Every key may call it whatever its scopes (`anyScope`), since it only removes access.                                                                                                                                                                                                                                                                                                                  |
| `/api/v1/me/starred/[guid]`                              | `PUT/DELETE`  | Authenticated. Acts on `locals.user.id`'s own profile only: `IUserProfileStore` enforces self-or-admin scoping.                                                                                                                                                                                                                                                                                                                                                                                            |
| `/api/files/[...path]`                                   | `GET`         | Storage proxy. Public buckets serve unauthenticated; private buckets need an authenticated session whose ctx authorizes the resource the path encodes.                                                                                                                                                                                                                                                                                                                                                     |

### Admin API (`/api/admin/*`)

Instance-level only. Denial returns **403** (not a redirect).

| Route                                       | Method             | Permission                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/admin/users`                          | `*`                | `manage_instance_users`. POST with platform permissions needs `instance_admin`.                                                                                                                                                                             |
| `/api/admin/users/[id]`                     | `PATCH/DELETE`     | `manage_instance_users`. PATCH that changes platform-scope permissions also needs `instance_admin`. DELETE also needs it for an admin target, consults `countInstanceAdminsExcluding` (409 on the sole admin), and refuses (409) the sole owner of any org. |
| `/api/admin/users/[id]/disable`             | `POST`             | `manage_instance_users`. Same admin-target and sole-admin rules as DELETE. Revokes the user's API tokens.                                                                                                                                                   |
| `/api/admin/compute`                        | `*`                | `manage_compute`                                                                                                                                                                                                                                            |
| `/api/admin/compute/status`                 | `GET`              | `manage_compute`                                                                                                                                                                                                                                            |
| `/api/admin/compute/actions`                | `POST`             | `manage_compute`. Operational actions against a configured server (restart, cache clear), not config writes.                                                                                                                                                |
| `/api/admin/system/update`                  | `GET/POST`         | `instance_admin`, not `manage_updates`. POST runs the self-update and streams SSE; GET polls the npm registry (`?check=1`) or returns the tee'd update log so the UI can recover output from the restart blackout.                                          |
| `/api/admin/system/health`                  | `GET`              | `instance_admin`: re-runs the integrity checks live and names which compute servers failed and why.                                                                                                                                                         |
| `/api/admin/system/throughput`              | `GET/POST`         | `instance_admin`. Bandwidth probe: GET streams random bytes downstream, POST consumes and discards an upload. The download side is a data faucet, hence the narrowest gate.                                                                                 |
| `/api/admin/orgs`                           | `*`                | `instance_admin`                                                                                                                                                                                                                                            |
| `/api/admin/projects`                       | `GET/POST`         | `instance_admin`. GET lists every `platform` project; POST creates one. Both 404 while `ENABLE_PLATFORM_PROJECTS` is off.                                                                                                                                   |
| `/api/admin/orgs/[id]`                      | `*`                | `instance_admin`                                                                                                                                                                                                                                            |
| `/api/admin/projects/[id]`                  | `GET/PATCH/DELETE` | `instance_admin`.                                                                                                                                                                                                                                           |
| `/api/admin/projects/[id]/grants`           | `GET/POST`         | `instance_admin`. POST body: `{ granteeType, granteeId, canSolve }`.                                                                                                                                                                                        |
| `/api/admin/projects/[id]/grants/[grantId]` | `DELETE`           | `instance_admin`. Hard-delete (immediate revocation).                                                                                                                                                                                                       |

### The two-shell rule

Selva has two admin areas that never mix:

- **`/admin/*`**, the **platform** shell: the whole instance (users, orgs, the compute pool, system updates), gated on platform permissions.
- **`/team/*`**, the **organization** shell: the one org the user is acting in (members, projects, compute override, settings), gated on org permissions.

**No route appears in both.** Reclaim is an org concern, so it lives at `/team/reclaim`; managing instance users is a platform concern at `/admin/users`. A user holding both kinds of authority moves between the shells through the header; the views are not merged.

### Admin pages (`/admin/*`)

The shell admits **platform** operator permissions only (every platform permission except `manage_api_tokens`). Org-scope permissions (`manage_org_members`, `manage_org_compute`, `manage_definitions`, `manage_projects`) never admit you, even though they share the `manage_*` prefix. Layout-level denial redirects to `/library`; sub-page denial redirects to `/admin`.

| Page                   | Permission                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin` (dashboard)   | Any operator platform permission                                                                                                                                                                                      |
| `/admin/users`         | `manage_instance_users`                                                                                                                                                                                               |
| `/admin/compute`       | `manage_compute`                                                                                                                                                                                                      |
| `/admin/organizations` | `instance_admin`; redirects away in `tenancy: 'single'`                                                                                                                                                               |
| `/admin/projects`      | `instance_admin`; 404 while `ENABLE_PLATFORM_PROJECTS` is off                                                                                                                                                         |
| `/admin/audit`         | `instance_admin`; listed only when the event sink is queryable (Supabase)                                                                                                                                             |
| `/admin/system`        | Nav entry for `manage_updates`; the page loads for any operator permission. Health and network panels need `instance_admin`; the Update runner is shown to `manage_updates` but only `instance_admin` can run it (§2) |

### Team pages (`/team/*`)

The shell is org-level. Platform permissions never admit you on their own, but `instance_admin`'s centralized bypass (§5) still lets staff load these pages while acting in any org. `/team/tokens` is the exception for a different reason: a key belongs to one org, and who may hold one is `canHoldApiTokens`, not an org permission. Tenancy is implicit via `ctx.actingOrgId`; routes never accept a target org through the URL or query. Sub-page denial redirects to `/team` (`/team/members` to `/library`).

| Page                      | Permission                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/team`, `/team/activity` | Any org membership                                                                                                                                                    |
| `/team/members`           | `manage_org_members`. Role changes are owner-only (§3).                                                                                                               |
| `/team/projects`          | `manage_projects`                                                                                                                                                     |
| `/team/reclaim`           | `manage_org_members` (a proxy for org owner/admin); the load-bearing check is `canReclaim` (§5) on the API endpoint                                                   |
| `/team/shares`            | `manage_org_members` (not `manage_definitions`); 404 while `ENABLE_SHARING` is off                                                                                    |
| `/team/tokens`            | May hold some API token (`canHoldApiTokens`). Someone who may hold only upload keys sees only the upload preset; the org-wide roster also needs `manage_org_members`. |
| `/team/compute`           | `manage_org_compute`. Server-add controls are hidden while `ALLOW_ORG_COMPUTE_OVERRIDE` is off; default selection still works against shared platform servers.        |
| `/team/settings`          | `manage_org_members`                                                                                                                                                  |

### Auth flow (`/auth/*`)

Public routes: the auth round-trip is the credential flow, so no permission check applies. `/auth/supabase/{start,callback}` (OAuth) and `/auth/email/{start,callback}` (email link) run `bootstrapUserSession` after verifying the identity, which grants every platform permission to the signer if no `instance_admin` exists and the tenancy policy allows it (§2).

---

## 9. Data model invariants

Cheap to lock in now, expensive to retrofit later.

- **Tenancy.** Projects carry `orgId`. Definitions, versions, share links and project members reach their org through the project; none of `DefinitionRecord`, `ProjectMember` or `ShareLink` has an `orgId`. Row-level tenant isolation (RLS) builds on this.
- **Audit fields.** Mutable entities carry `createdBy`/`createdAt`, `updatedBy`/`updatedAt` and a nullable `deletedAt` (soft delete). Not every type has every field: `ShareLink` has `revokedAt` instead of `deletedAt` and no `updated*`.
- **Soft delete is enforced at the data-access layer.** Reads filter `deletedAt IS NULL` in the repository, view or RLS policy, never at individual call sites: one missed filter in a route handler is a data leak, and application code should not be able to read a soft-deleted row by accident.
- **`RequestContext.user` is an identity, not necessarily a human.** A service account, anonymous visitor or share-token synthetic identity slots in without changing rule signatures.
- **`actingOrgId` is optional in the type** (undefined for instance-admin global reads and pre-org routes) **but required at every handler that touches tenant-owned data,** which rejects with 400 when it is missing.
- **User ids on entities may become unresolvable** after account deletion. The UI renders "Deleted user"; entities are not orphaned.
- **`Definition.ownerId` is set to the uploader at creation and no route changes it.** `DefinitionRecordPatch` still types it as writable, so this is convention, not a type guarantee: a future patch route wiring `ownerId` through would silently transfer edit authority on a commons project. In container mode it is display metadata; in commons mode it is an access-control input (§4). If the owner's account is deleted, only project editors can edit the definition.
- **Events.** Every successful mutation emits a domain event (`project.created`, `definition.published`, `org_member.removed`, `project_member.removed`, `share_link.minted`, `share_link.revoked`, …). Supabase wires `SupabaseEventSink`, persisting each event to `audit_events` (type, actor, timestamp, JSONB payload), browsable at `/admin/audit`. Local uses `NoopEventSink`: dev mode has no audit requirement. Webhook dispatch would plug in as another `IEventSink`.

---

## 10. Offboarding & ownership transfer

- **Disable user (instance-wide):** `manage_instance_users` sets `disabled=true`. Identity and attribution are preserved, and the user's API tokens are revoked. The instance that disables drops them from its key cache at once; another instance stops accepting them within its 60-second window (`createApiTokenResolutionCache`).

  **Cutoff is bounded, not instant, and the bound differs per provider.** `sessionRefresh.revokeSession` takes the _target's_ session token, which an admin disabling someone else does not hold, and neither the interface nor GoTrue's admin API revokes by user id.

  | Provider          | An already-issued session after disable                              |
  | ----------------- | -------------------------------------------------------------------- |
  | Local (HMAC)      | Dies on the next request: `verifyToken` re-reads the user            |
  | header-auth       | Dies on the next request: every request re-identifies from headers   |
  | Supabase (hybrid) | Accepted until `revalidateMs` elapses (default 60s), then re-checked |
  | Supabase (strict) | Dies on the next request                                             |

  The 30-day refresh token never survives: `refreshSession` rejects a disabled user, so the window is bounded by the access token's own lifetime. Closing the last seconds needs `revokeAllForUser` on `ISessionRefresh` plus a privileged RPC deleting `auth.refresh_tokens` rows, out of proportion to a 60-second window, so it is not built. **Logout is fully closed:** `/logout` revokes provider-side before clearing the cookie, so a captured token from a shared machine does not outlive the session.

- **Remove user from org:** org `owner`/`admin` via `manage_org_members` (owner-only when the target is an owner). The user loses all project memberships and their API tokens in that org. They still exist on the instance.

  **Pending invites addressed to them are revoked,** by email rather than user id, since an invite names an address and the account it creates may not exist yet. It is one `revokePendingByEmail(ctx, orgId, email)` call, not list-then-revoke-each, so a concurrent accept cannot slip between two round-trips. Without it an unaccepted invite stays valid for its 7-day TTL and readmits the user at their original role. A failure here is logged, not fatal: the removal has already committed, and reporting an offboarding that happened as one that didn't is the worse outcome.

  **Share links they minted stay live, on purpose.** A share link is an org asset that happens to have a minter. Revoking it inconveniences whoever holds the URL, usually a client, not the person leaving, who had an account rather than a link. Cascade-revoke would also fire only on org-member removal, so disabled users' links would survive it anyway. The compensating control is the **org-wide share-link roster** at `/team/shares`, gated on `manage_org_members`, never `manage_projects`, which a plain member may hold and has no business enumerating every credential in the tenant. Seeing the roster confers no authority over it: revoking still needs edit rights on the parent definition, so the page reuses the per-definition DELETE endpoint. Auto-revoke can be layered on the roster later; the reverse does not work.

- **Sole-owner projects on offboarding:** removal **proceeds**, and the projects left without an owner are reported in one `org_member.removed_orphaning_projects` event. No silent reassignment, no block. Blocking was rejected because its cost scales with how many projects the departing person owned, which is backwards: the most prolific people are the ones whose departure most needs to be clean, and a stalled offboarding leaves them in the org while someone works the backlog. An ownerless project is recoverable at leisure through **Reclaim** (§5); a half-finished removal is a live account. The check runs **before** the removal, because `removeOrgMember` cascades the `project_members` rows it reads.

- **Sole instance admin:** blocked with 409, as in §2. Non-runtime corruption is recoverable through `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` (§2).

- **Delete user (hard):** admin-initiated, through the auth provider, and refused (409) while the user is the only owner of any org: `canReclaim` needs an org owner or admin, so an ownerless org has no way back. Selva's references resolve to "Deleted user." Share links the user minted are deleted with them (§7).

- **Org ownership transfer:** not built. `/team/settings` shows a disabled button and no endpoint exists. Promote a second owner to hand an org over (§3).

---

## 11. Scenarios (sanity checks)

Rules that are easy to get wrong.

| Scenario                                                                                                              | Outcome                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bob (Acme `member`, no project membership) views and solves an Acme `org` project, then tries to edit its definition. | **View/solve OK:** org visibility grants both to every org member. **Edit 403:** `canEditDefinition` needs an explicit project `owner`/`editor` role.                                                                                          |
| Alice (Acme `admin`) grants Bob (`member`) the `manage_projects` permission.                                          | **OK.** `manage_org_members` covers grantable permissions. Bob can now create projects; his role stays `member`.                                                                                                                               |
| Marcus (Acme `admin`, no project memberships) opens `/projects`.                                                      | He sees `org` and `public` Acme projects (any org member's entitlement) but **not** private ones he isn't a member of. A plain `member` such as Bob sees the same set: org role changes nothing here. Reclaim is the explicit escalation path. |
| `instance_admin` deletes the only other user, who also holds `instance_admin`.                                        | Allowed. The sole-admin check excludes only the target, and the actor still holds the grant.                                                                                                                                                   |

---

## 12. Deferred (tracked, not built)

Designed-for but not implemented. Each can ship later without breaking the model.

- Cross-org guest on a private project
- **Personal scope outside any org:** a scope that belongs to the user, with no org leadership and so no Reclaim. Until it ships, a `private` org project is the closest alternative, but the org owner can still Reclaim it. The `actingOrgId` discipline would carry through a sentinel or a parallel `personalScopeId`.
- Project transfer between orgs (the data model allows it)
- **Service accounts.** API tokens act as the user who minted them and die when that member leaves. Org-owned keys that survive a departure are not built.
- Webhooks (events emit; there is no dispatcher)
- Per-org data residency / storage backends
- Project templates / bulk member operations (a pressure valve for flat ACLs at scale)
- **Multi-tenant SaaS mode:** self-service signup, public org creation, plan/billing, quota enforcement, past-due state. The data model and the `tenancy: 'multi'` switch already accommodate it. Constraints for when it ships:
  - **Plans are a fourth axis, orthogonal to platform/org/project.** Model them as feature flags and quotas on `Org`, not as permissions or roles. Handlers do `canX(...) && plan.allows('x', currentCount)`: two checks, both must pass. That keeps `rules.ts` free of billing and lets new tiers ship without touching access logic.
  - **A user with zero orgs needs handling.** §9 requires `actingOrgId` at every tenant-touching handler (400 if missing), but fresh signups have no org. Those routes need an allowlist (create org, profile, logout) and the rest should redirect to a "create or join an org" page.
  - **`/setup` and `/signup` stay separate routes.** `/setup` seeds staff: run-once, reachable only while no `instance_admin` exists, grants every platform permission. `/signup` creates plain users forever, with no platform permissions. Separate files let a deployment disable `/signup` without touching `/setup`, and keep the staff-seed path's narrower attack surface obvious.

---

## 13. Change discipline

The rules that keep this model from rotting:

1. **Permissions are extensible; roles are not.** Roles are named bundles of permissions; adding a role is a schema migration and UX churn, adding a permission is cheap. When in doubt, add a permission and map it into the existing roles.
2. **No permission inheritance.** Each project carries its own ACL, with no cascading from folders, orgs or templates. Org permissions don't leak into project rules.
3. **A rule that two routes must agree on is a function, not a paragraph.** Almost every real access defect was a rule that existed correctly in one place and was retyped, slightly differently, in another: the owner-only role gate written out in three routes, the sole-admin lock mirrored client-side from a truncated page, the platform-permission delegation rule copied three times. None were subtle logic errors. The test for whether a rule is safe is not "is it correct in every copy today" but **"does breaking it turn one edit into a red test everywhere it applies."** If not, the copies will drift, and an audit will find the drift instead of CI.

   Concretely: pure predicates go in [`rules.ts`](../../packages/platform/src/access/rules.ts), loading their inputs goes in the guards ([`guards.ts`](../../packages/server/src/access/guards.ts)), and routes call the guard. UI that gates on a server rule receives the **answer** from its loader instead of recomputing the rule client-side.

When in doubt: **flat, explicit, and one concept per scope.**
