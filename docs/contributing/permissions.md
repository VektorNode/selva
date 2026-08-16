# Access Control — Selva

The single source of truth for who can do what. Code conforms to this doc.

---

## 1. Mental model

Three scopes of authority, broadest to narrowest:

| Scope        | Applies to                     | Answers                                                 |
| ------------ | ------------------------------ | ------------------------------------------------------- |
| **Platform** | The entire Selva instance      | "Can you administer the instance itself?"               |
| **Org**      | A single organization (tenant) | "Which tenant's data can you touch, and how much?"      |
| **Project**  | A single project inside an org | "In this project, are you a contributor or a consumer?" |

**Org is the hard tenancy boundary.** No resource crosses org lines except explicit `public` projects
(§4) and `platform` projects reached through a grant (§4a).

A user can belong to multiple orgs, with independent permissions in each. Every request carries an
acting org (`RequestContext.actingOrgId`), and tenancy checks compare it to the resource's `orgId` —
never "is the user a member of _some_ org that matches." That distinction is what prevents cross-org
leaks for multi-org users.

---

## 2. Platform scope

Four permissions, all instance-wide ([permissions/types.ts](../../packages/platform/src/permissions/types.ts)):

| Permission              | Grants                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `instance_admin`        | Superuser. Implies every other permission, everywhere.                                                                  |
| `manage_compute`        | Platform compute servers: create/edit/delete, per-org sharing (`sharedWith`), and the global `defaultServerId`. See §3. |
| `manage_instance_users` | Disable/enable any user on the instance.                                                                                |
| `manage_updates`        | Run system updates.                                                                                                     |

**Invariant: at least one user holds `instance_admin`.** Any operation that would zero it out —
revoking the permission, deleting or disabling that user — is rejected. `IPlatformPermissionStore.set`
enforces revocation directly; delete/disable is blocked by the route handler consulting
`countInstanceAdminsExcluding(targetId)` before calling the auth provider. The admin UI mirrors this
by disabling the control on the sole admin. See §10.

**`instance_admin` does not bypass content access.** The bypass (§5) covers management actions only —
user administration, org management, compute config, project governance. `canView`, `canSolve`,
`canEdit`, and `canEditDefinition` run as-is regardless of platform role. Staff who need to read a
private project Reclaim it first, which leaves an audit trail.

This is a least-privilege decision: blanket admin content access enlarges the blast radius of a
compromised account and is hard to justify in a data audit. The API layer enforces it; raw
database/filesystem access is a separate physical-security concern.

**Break-glass recovery.** If the invariant is bypassed by non-runtime means (manual DB edits, a
backup restore predating the invariant, migration drift), set `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` and
have the named user sign in. The path grants every platform permission iff no admin exists _and_ the
signing-in email matches, so it is safe to leave permanently set.

**Deployment modes** come from `SELVA_TENANCY`:

- **`single`** (default) — one org, provisioned at `/setup`. The `instance_admin` is usually also the
  org owner. Without `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, the first signer on a fresh install wins the
  bootstrap race; setting the var hardens it to a named operator.
- **`multi`** — many orgs. `instance_admin` is staff-only; customers never hold it. The bootstrap
  path is closed unless `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is set and matches, so the first random
  signup cannot become staff.

---

## 3. Org scope

### Roles

| Role     | Default permissions                                       |
| -------- | --------------------------------------------------------- |
| `owner`  | All four. Cannot be demoted by anyone but self-transfer.  |
| `admin`  | All four.                                                 |
| `member` | None. Grantable: `manage_definitions`, `manage_projects`. |

Owner and admin share every permission. The structural difference is that **only `owner` can change
roles** — promote a member, demote an admin, or transfer ownership (§10). Owner is the role that
cannot lock itself out; admin is the role you grant freely and can revoke.

**Org role does not grant project visibility.** An admin sees only projects they are a member of,
plus `org`/`public` projects per §4. Private projects they aren't a member of are invisible to them
and absent from `/projects`. The escape hatch is `canReclaim` (§5), which is auditable — org role
never silently bypasses a project ACL (§13 rule 2).

### Permissions

| Permission           | Grants                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manage_org_members` | Invite and remove members; grant/revoke `manage_definitions` and `manage_projects`. Owner/admin only. **Does not include role changes** — those are owner-only.                                       |
| `manage_definitions` | Upload/edit definitions in this org (further gated by project role).                                                                                                                                  |
| `manage_projects`    | Create projects in this org. Editing and deleting are gated by project role.                                                                                                                          |
| `manage_org_compute` | Create/edit/delete this org's own compute servers and set `orgDefaults[orgId]`. Owner/admin only, and gated by `ALLOW_ORG_COMPUTE_OVERRIDE` — when off, the org uses platform servers shared with it. |

`manage_org_members` and `manage_org_compute` are not assignable to `member`
(`MEMBER_ASSIGNABLE_PERMISSIONS` in
[organizations/schemas.ts](../../packages/platform/src/organizations/schemas.ts)).

`manage_compute` stays at platform scope: which servers exist, who sees each one, and the global
default are the platform admin's concern.

### Invites

Org-scoped only. Once in an org, project membership is managed within-org (§5). Cross-org project
guests are deferred (§12).

### Compute servers, sharing, and defaults

A server is owned by exactly one scope — a discriminated union, not a flag:

- **Platform** (`scope: 'platform'`) — created by `manage_compute`, with `sharedWith: 'all' |
string[]` controlling which orgs see it.
- **Org-private** (`scope: 'org'`, `ownerOrgId`) — created by an org owner/admin with
  `manage_org_compute`, visible only to that org, gated by `ALLOW_ORG_COMPUTE_OVERRIDE`.

Defaults are layered:

- **`defaultServerId`** (global, set by `manage_compute`) must reference a platform server and is
  **always usable by every org regardless of `sharedWith`** — the baseline floor of the system.
- **`orgDefaults[orgId]`** must reference a server visible to that org. Only meaningful once the org
  has more than the global default to choose from.

A platform server with `sharedWith: []` that isn't the global default is dormant — admin-only,
unusable for solves.

**Visibility** (`serversVisibleTo`, [computeServer/utils.ts](../../packages/platform/src/computeServer/utils.ts)):

```
platformServers.filter(s =>
  s.id === defaultServerId || s.sharedWith === 'all' || s.sharedWith.includes(orgId)
) ∪ orgServers.filter(s => s.ownerOrgId === orgId)   // only when ALLOW_ORG_COMPUTE_OVERRIDE
```

**Resolution**, narrowest wins, pure and I/O-free:

1. `Definition.computeServerId`, if that server is in `serversVisibleTo(project.orgId)`. A pin to a
   no-longer-visible server falls through — defensive, since an admin may have un-shared it since.
2. `orgDefaults[project.orgId]`.
3. The global `defaultServerId`.

An org misconfiguring its own server only affects that org's solves. Platform-server administration
cannot be touched by org admins under any circumstance.

---

## 4. Project scope

### Roles

| Role     | View/solve | Edit definitions | Manage project |
| -------- | :--------: | :--------------: | :------------: |
| `owner`  |     ✅     |        ✅        |       ✅       |
| `editor` |     ✅     |        ✅        |       ❌       |
| `viewer` |     ✅     |        ❌        |       ❌       |

`viewer` exists for clients, stakeholders, and auditors: they see schemas, submit solves, and
download results, but cannot modify the definition.

### Visibility

| Visibility | Who can view/solve                                          |
| ---------- | ----------------------------------------------------------- |
| `private`  | Project members only.                                       |
| `org`      | Any member of the parent org.                               |
| `public`   | Any authenticated user; cross-org only when the flag is on. |
| `platform` | `instance_admin` only, plus explicit grant holders (§4a).   |

New projects default to `private`. Anonymous access is never a project flag — it comes from
per-definition share links (§7).

**`private` means private from everyone without a membership, including org leadership.** A member's
personal R&D, work not ready to show a manager, a side project inside an org — all valid. The escape
hatch is Reclaim (§5), an explicit auditable action that adds the actor as co-owner. That audit trail
is the load-bearing protection: access costs one intentional step, not a silent default.

The three privacy scopes are separated by scope rather than by flag:

| Need                                       | How                                              |
| ------------------------------------------ | ------------------------------------------------ |
| Private from org peers                     | `private` project inside an org                  |
| Visible to org leadership + members        | `org`-visibility project                         |
| Private from everyone including leadership | Personal scope (§12, deferred) — outside any org |

### Project members must be org members

Enforced in the **rule layer**, not as a DB constraint — leaving room for cross-org guests and service
accounts later without a schema migration.

### The two project models

Selected per-project by `autoJoinOnUpload` (settable only on `public` projects):

**Container** (`false`, default) — enterprise and client work. Project role is authoritative; only
`owner`/`editor` upload or edit. Definition ownership is display metadata.

**Commons** (`true`) — user-generated content. Any authenticated user can upload a _new_ definition
and becomes its **definition owner** (not a project member). They can edit and delete their own and
nobody else's; project `owner`/`editor` retain moderation authority over everything.

The commons contract protects the Alice/Peter case: Peter cannot upload a new version of Alice's
definition, but he can upload and edit his own.

Flipping `autoJoinOnUpload` on a project with existing definitions applies the commons contract to
new definitions only; existing ones stay under project-role control with `createdBy` treated as the
owner.

---

## 4a. Platform-admin projects

A project with `visibility = 'platform'`, owned and operated exclusively by `instance_admin`.
External parties get **view/solve** through explicit grants and can never edit or manage. Gated by
the `ENABLE_PLATFORM_PROJECTS` flag — when off, the rules treat these projects as inaccessible even
for instance admins, and the data survives the toggle.

Why a visibility level rather than a role: no membership rows are needed (`instance_admin` governs
through platform role), grants stay a narrow auditable entitlement with no org-membership side
effects, and a new role would be a schema migration (§13 rule 1).

Platform projects live inside a real org so storage routing and compute resolution have a tenancy
boundary, but membership in that org grants nothing — the visibility type governs everything.
`autoJoinOnUpload` is invalid here; `validateProjectFlags` rejects the combination.

### Grants

```
PlatformProjectGrant {
  id          string    PK
  projectId   string    FK projects(id), ON DELETE CASCADE
  granteeType 'org' | 'user'
  granteeId   string    orgId or userId
  canSolve    boolean   false = view-only; true = view + solve
  createdBy   string
  createdAt   ISO
}
```

An `org` grant applies to all current and future members of that org; a `user` grant applies to that
user regardless of org membership. Revocation is a hard delete — immediate, no downstream references.

### Rules for platform projects

- `canView` — `instance_admin`, or any grant (view-only or `canSolve`) matching `user.id` or
  `ctx.actingOrgId`.
- `canSolve` — `instance_admin`, or a matching grant with `canSolve = true`. Strictly narrower than
  `canView`: a view-only holder fetches the schema but cannot submit solves.
- `canEdit` / `canEditDefinition` / `canManage` / `canEditProjectSettings` — `instance_admin` only.
  This is not the §5 bypass; for platform projects, admin status _is_ the rule.
- `canReclaim` — always `false`. There is no org ownership to reclaim.

---

## 5. Rules

The pure predicates live in [access/rules.ts](../../packages/platform/src/access/rules.ts). They take
already-resolved entities (project, memberships, permissions, grants, flags) and return booleans —
adapters do the lookup, rules do the logic.

**Single source of truth.** Every gate — adapter `can*` methods, route-layer `require*` helpers —
funnels through `rules.ts`. The route layer pre-loads the membership rows a rule needs and calls it
directly.

### The `instance_admin` bypass is split: management yes, content no

`rules.ts` exports `withAdminBypass(platformPermissions, rule)` but never bakes the bypass into a rule
body. The app wraps calls through two helpers in
[access.server.ts](../../packages/selva/src/lib/server/access.server.ts):

- **`managementBypassOrRun`** — governance actions: Reclaim, create/delete project, manage project
  members, edit project settings. `instance_admin` bypasses, so staff can administer the instance
  without being a member of every org.
- **`contentCheck`** — content access: `canView`, `canSolve`, `canEdit`, `canEditDefinition`. **No
  bypass.** Staff who need private content Reclaim first.

Keeping the two wrappers separate means a bug in a rule doesn't become a bug in god-mode, and the
security boundary is reviewable in one place.

### Share-link grants are a parallel path

A request authenticated by a valid share-link token (§7) is granted access to **one
(definitionId, channel) pair only**, regardless of project visibility or membership. Token validation
runs before the user-based rules; when a token resolves, those rules are skipped for that request.

### The predicates

**`canView(input)`**

- `private` → user is a project member (any role)
- `org` → `ctx.actingOrgId === project.orgId` and the user is a member of that org
- `public` → authenticated, and either `ALLOW_CROSS_ORG_PUBLIC` is on or the user is a member of the
  parent org. With the flag off, `public` narrows to the publishing org — the flip is still allowed
  (see `canChangeVisibilityToPublic`), only the reach changes.
- `platform` → see §4a

**`canSolve(input)`** — for non-platform projects the body is currently `canView`. It stays a separate
function so future solve-gating (quotas, rate limits, compute budgets) has an obvious home without
retrofitting view semantics. For `platform` projects the bodies diverge (§4a).

**`canEdit(input)`** — project `owner` or `editor`. The generic "can this user touch project-scoped
resources" predicate: filtering the project list, gating new-definition uploads on container
projects, and the building block for `requireCanEdit`.

**`canEditDefinition(input)`** — project `owner`/`editor` always (moderation authority); or
`autoJoinOnUpload` and `user.id === definition.ownerId` (commons). Takes the definition because
commons ownership is per-definition; in container mode the definition isn't consulted.

The rule is pure. Setting `ownerId = uploader.id` on a new commons definition is a handler
responsibility, and the uploader does not become a project member.

**`canEditProjectSettings(input)`** — project `owner` only. An earlier draft allowed
`editor + manage_projects`, which leaked an org permission into project authority (§13 rule 2).

**`canChangeVisibilityToPublic(input)`** — org `owner` or `admin`. Flipping to `public` is a
disclosure action and needs stricter perms than normal editing. `ALLOW_CROSS_ORG_PUBLIC` does not
gate this rule; it only changes what `public` means afterwards, which `canView` enforces.

**`canManage(input)`** — project `owner` only. Deletes the project and manages members.

**`checkOwnerRemoval(input) → 'ok' | 'sole_owner' | 'needs_confirm'`** — pre-flight the route runs
after `canManage` authorized the actor. Non-owner target → `ok`. Sole owner → `sole_owner` (409,
suggests reclaim). Owner-on-owner without `?confirm=true` → `needs_confirm` (409; the client retries
confirmed). Pure, over already-loaded membership rows, so behaviour is identical across providers.

**`canReclaim(input)`** — `false` for `platform` visibility; otherwise `ctx.actingOrgId ===
project.orgId` and the user is org `owner` or `admin`. **Reclaim adds the actor as a co-owner and does
not demote the existing owner** — the original owner keeps access, and the escalation is on the
record.

**`canCreateProject(input)`** — `ctx.actingOrgId === org.id` and the user is org `owner`/`admin`, or a
`member` holding `manage_projects`. The creator becomes project `owner`.

### Upload semantics

- **New definition** (`POST /api/v1/definitions`) — container projects need project `owner`/`editor`;
  commons projects accept any authenticated user, and the handler sets `ownerId` to the uploader.
- **New version** (`POST /api/v1/definitions/[guid]/versions`) — `canEditDefinition`. In commons mode
  that means project editor _or_ the definition owner; random users cannot version-bump someone
  else's work.

---

## 6. Definition versioning

Immutable versions plus named channels pointing at them.

- `DefinitionVersion { id, definitionId, versionNumber, fileExt, fileKey, originalFilename?,
uploadedBy, uploadedAt, schema?, schemaExtractedAt? }`
- `Definition.liveVersionId` — the published version external consumers solve
- `Definition.draftVersionId` — the latest upload, what editors test against

`fileExt` and `originalFilename` live on the version, not the parent — different versions can carry
different uploaded filenames or extensions.

| Channel | Points to        | Who can solve it                             |
| ------- | ---------------- | -------------------------------------------- |
| `live`  | `liveVersionId`  | Anyone who passes `canSolve` for the project |
| `draft` | `draftVersionId` | Project `owner` / `editor` only              |

Flow: upload creates `v1` with both channels on it; re-upload creates `v2` and advances `draft` only;
**Publish** advances `live`. Rollback re-points `liveVersionId` at any prior version — a first-class
operation, not a re-upload.

A version cannot be deleted while referenced by either pointer (FK `ON DELETE RESTRICT` in Postgres,
explicit check in the local provider), so a buggy handler cannot orphan one.

Versioning applies to every definition regardless of project visibility. One model everywhere.

---

## 7. Share links

Per-definition tokens granting access to one definition + channel without an account. One mechanism
covering both sharing a draft for review and embedding a definition in a public iframe. Gated by
`ENABLE_SHARING`; when off, the admin routes reject mint/list/revoke and existing tokens stop
resolving.

Why this shape:

- **Definition-scoped.** A leaked link exposes one definition; definitions added to the project later
  are not auto-included.
- **Parallel grant system.** Tokens never mutate `Project.visibility` or membership. A private project
  can have share links; a public project need not.
- **Explicit opt-in per link**, minted by someone who can edit the definition, revoked per link.
- **Token leakage is the design assumption**, not a failure mode — anyone viewing an iframe sees the
  token. Per-link caps and revocation are the load-bearing protections, not secrecy.

### Data model

```
ShareLink {
  id           string    PK
  definitionId string    FK definitions(guid), ON DELETE CASCADE
  channel      'live' | 'draft'
  tokenHash    string    HMAC of the raw token; raw shown once at mint
  name?        string    label, UX only
  createdBy    string
  createdAt    ISO
  expiresAt?   ISO       null = no expiry
  revokedAt?   ISO       soft-delete; resolution checks IS NULL
  allowSolve   boolean   false = view-only (schema fetch); true = solve
  maxSolves?   number    null = unlimited (opt-in)
  solveCount   number    atomic increment per successful solve
}
```

Minting requires `canEditDefinition` — the same rule that gates uploads, and the same authority
revokes. Tokens are issued with a default `maxSolves` cap; the minter can raise or remove it with an
extra confirm step. An uncapped token in an iframe with no expiry is a denial-of-wallet vector.

### Token resolution

A definition-scoped request carrying `?token=…` (or `Authorization: Bearer …`) goes through
[shareLinks/resolve.server.ts](../../packages/selva/src/lib/server/shareLinks/resolve.server.ts):

1. HMAC the token; look up `tokenHash`.
2. Token must exist, `revokedAt IS NULL`, `expiresAt IS NULL OR > now()`, and the parent definition
   must still be live.
3. The token's `definitionId` and `channel` must equal the requested ones — strict equality.
4. Solve routes additionally require `allowSolve = true`.
5. Build a synthetic `RequestContext` scoped to the token: no user identity, tenancy = the project's
   `orgId`, no platform or org permissions.
6. Skip `canSolve` / `canView`. The token _is_ the authorization.
7. On a solve, atomically check-and-increment `solveCount`. **The cap is enforced here, not at
   resolution** — a check at resolution races concurrent solves. Postgres does it in one statement
   (`UPDATE … WHERE solve_count < max_solves OR max_solves IS NULL RETURNING …`, returning nothing on
   a hit → 429); the local provider does read-modify-write, acceptable at single-node scale.

A failed check falls through to user-based auth; no token and no session ends in 401.

**Only `/api/v1/compute` accepts a share token.** The definition-addressed
`/api/v1/definitions/[guid]/solve` deliberately has no share-token branch and must never grow one.

### Cascade

Definition soft-deleted → tokens fail closed. Hard-deleted → tokens FK-cascade. Project deleted →
cascades through the definition. The creator's account being deleted leaves tokens working — a share
link shouldn't break when a contributor leaves.

### Deliberately not in v1

- **JWT** — every check hits the DB anyway (revocation, counter), so stateless validation buys
  nothing.
- **Per-version pinning** — tokens follow the channel pointer, same semantics as rollback.
- **Origin/Referer allowlist** — trivially bypassed server-side; false sense of security.
- **Project-scoped tokens** — granularity is one definition; five shares means five revocable links.

---

## 8. API route matrix

`instance_admin` passes management rows via `managementBypassOrRun`, but **not** content rows (§5).

### Content API (`/api/v1/*`)

| Route                                             | Method        | Rule                                                                                                                                                                           |
| ------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/v1/projects`                                | `GET`         | `canView` filtering. Org role is not a substitute for project membership; private projects the caller isn't a member of must not appear.                                       |
| `/api/v1/projects`                                | `POST`        | `canCreateProject`                                                                                                                                                             |
| `/api/v1/projects/[id]`                           | `GET`         | `canView`                                                                                                                                                                      |
| `/api/v1/projects/[id]`                           | `PATCH`       | `canEditProjectSettings`. Visibility → `public` additionally requires `canChangeVisibilityToPublic`.                                                                           |
| `/api/v1/projects/[id]`                           | `DELETE`      | `canManage`                                                                                                                                                                    |
| `/api/v1/projects/[id]/reclaim`                   | `POST`        | `canReclaim`                                                                                                                                                                   |
| `/api/v1/projects/[id]/members`                   | `GET/POST`    | `canManage`. Target must be an org member (rule layer).                                                                                                                        |
| `/api/v1/projects/[id]/members/[userId]`          | `PATCH`       | `canManage`                                                                                                                                                                    |
| `/api/v1/projects/[id]/members/[userId]`          | `DELETE`      | `canManage` + `checkOwnerRemoval`. Sole-owner removal blocked; owner-on-owner needs `?confirm=true`.                                                                           |
| `/api/v1/definitions`                             | `POST`        | New definition. Container: project `owner`/`editor`. Commons: any authenticated user; handler sets `ownerId`.                                                                  |
| `/api/v1/definitions/[guid]`                      | `PATCH`       | `canEditDefinition` (metadata only)                                                                                                                                            |
| `/api/v1/definitions/[guid]`                      | `DELETE`      | `canEditDefinition`                                                                                                                                                            |
| `/api/v1/definitions/[guid]/image`                | `POST`        | `canEditDefinition`                                                                                                                                                            |
| `/api/v1/definitions/[guid]/publish`              | `POST`        | `canEditDefinition`. Body `{ versionId? }`; advances `live` to the draft or any prior version.                                                                                 |
| `/api/v1/definitions/[guid]/schema`               | `GET`         | `canView`                                                                                                                                                                      |
| `/api/v1/definitions/[guid]/solve`                | `POST`        | `canSolve`. **No share-token branch** — the URL-addressed `/api/v1/compute` owns that path.                                                                                    |
| `/api/v1/definitions/[guid]/versions`             | `GET`         | `canView`                                                                                                                                                                      |
| `/api/v1/definitions/[guid]/versions`             | `POST`        | New version. `canEditDefinition`; advances `draft`.                                                                                                                            |
| `/api/v1/definitions/[guid]/versions/[versionId]` | `DELETE`      | `canEditDefinition`. §6 deletion protection — 409 if referenced by either channel pointer.                                                                                     |
| `/api/v1/definitions/[guid]/share-links`          | `GET/POST`    | `canEditDefinition`. POST returns the raw token once.                                                                                                                          |
| `/api/v1/definitions/[guid]/share-links/[linkId]` | `DELETE`      | `canEditDefinition`. Soft-delete (sets `revokedAt`).                                                                                                                           |
| `/api/v1/compute`                                 | `POST`        | `canSolve`. Channel `live` (default) or `draft`; `draft` requires `canEditDefinition`. **A valid share token bypasses user auth for its pinned scope only.**                   |
| `/api/v1/compute/schema`                          | `POST`        | `requireCanCreateDefinition(projectId)` — same gate as creating a definition. Previews a user-supplied `.gh` before saving.                                                    |
| `/api/v1/orgs/[orgId]`                            | `GET`         | Org membership. URL `orgId` must equal `ctx.actingOrgId`.                                                                                                                      |
| `/api/v1/orgs/[orgId]/compute`                    | `GET/PATCH`   | `manage_org_compute`, gated by `ALLOW_ORG_COMPUTE_OVERRIDE`. Same tenancy check.                                                                                               |
| `/api/v1/orgs/[orgId]/assets/[kind]`              | `POST/DELETE` | `manage_org_members` — org branding is an org-admin action.                                                                                                                    |
| `/api/v1/orgs/[orgId]/members`                    | `GET/POST`    | `manage_org_members`                                                                                                                                                           |
| `/api/v1/orgs/[orgId]/members/[userId]`           | `PATCH`       | Role changes owner-only (§3); permission changes `manage_org_members`. Cannot demote the sole owner (409). `member` targets are restricted to `MEMBER_ASSIGNABLE_PERMISSIONS`. |
| `/api/v1/orgs/[orgId]/invites`                    | `GET/POST`    | `manage_org_members`                                                                                                                                                           |
| `/api/v1/orgs/[orgId]/invites/[id]`               | `DELETE`      | `manage_org_members`                                                                                                                                                           |
| `/api/v1/me`                                      | `GET`         | Authenticated; returns the caller's own identity.                                                                                                                              |
| `/api/v1/me/starred/[guid]`                       | `PUT/DELETE`  | Authenticated; `IUserProfileStore` enforces self-scoping.                                                                                                                      |
| `/api/files/[...path]`                            | `GET`         | Storage proxy. Public buckets serve unauthenticated; private buckets require a session whose ctx authorizes the path.                                                          |

### Admin API (`/api/admin/*`)

Instance-level only. Denial returns **403**, not a redirect.

| Route                                       | Method             | Permission                                                                                                                  |
| ------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `/api/admin/users`                          | `*`                | `manage_instance_users`                                                                                                     |
| `/api/admin/users/[id]`                     | `PATCH/DELETE`     | `manage_instance_users`. Platform-perm changes additionally require `instance_admin`. DELETE returns 409 on the sole admin. |
| `/api/admin/users/[id]/disable`             | `POST`             | `manage_instance_users`. Same sole-admin invariant.                                                                         |
| `/api/admin/compute`                        | `*`                | `manage_compute`                                                                                                            |
| `/api/admin/compute/actions`                | `POST`             | `manage_compute`                                                                                                            |
| `/api/admin/compute/status`                 | `GET`              | `manage_compute`                                                                                                            |
| `/api/admin/system/health`                  | `GET`              | `instance_admin`                                                                                                            |
| `/api/admin/system/throughput`              | `GET`              | `instance_admin`                                                                                                            |
| `/api/admin/system/update`                  | `POST`             | `manage_updates`                                                                                                            |
| `/api/admin/orgs`, `/api/admin/orgs/[id]`   | `*`                | `instance_admin`                                                                                                            |
| `/api/admin/projects`                       | `POST`             | `instance_admin`. Creates a `platform` project.                                                                             |
| `/api/admin/projects/[id]`                  | `GET/PATCH/DELETE` | `instance_admin`                                                                                                            |
| `/api/admin/projects/[id]/grants`           | `GET/POST`         | `instance_admin`. POST body `{ granteeType, granteeId, canSolve }`.                                                         |
| `/api/admin/projects/[id]/grants/[grantId]` | `DELETE`           | `instance_admin`. Hard delete — immediate revocation.                                                                       |

### The two-shell rule

- **`/admin/*`** — the **platform** shell: every user, every org, the instance compute pool, system
  updates, the audit log. Gated on platform perms exclusively; org-scope perms never grant entry even
  though they share the `manage_*` prefix. Sub-page denial redirects to `/admin`; no platform perm at
  all redirects to `/app`.
- **`/team/*`** — the **organization** shell: one org's members, projects, compute override, shares,
  activity, settings. Gated on org perms; tenancy is implicit via `ctx.actingOrgId` and routes never
  accept a target org from the URL. `instance_admin`'s management bypass still lets staff load these
  pages while acting in any org.

**No route appears in both.** Reclaim is an org concern (`/team/reclaim`); instance users are a
platform concern (`/admin/users`). A user holding both kinds of authority navigates between the two
shells from the header — the views are never merged.

| Page                   | Permission                                                                        |
| ---------------------- | --------------------------------------------------------------------------------- |
| `/admin` (dashboard)   | Any platform perm                                                                 |
| `/admin/users`         | `manage_instance_users`                                                           |
| `/admin/compute`       | `manage_compute`                                                                  |
| `/admin/organizations` | `instance_admin`                                                                  |
| `/admin/projects`      | `instance_admin`; 404s when `ENABLE_PLATFORM_PROJECTS` is off                     |
| `/admin/audit`         | `instance_admin`; degrades when the provider has no `auditQuery`                  |
| `/admin/system`        | Any platform perm (layout gate); the Update runner needs `manage_updates`         |
| `/team` (general)      | Any org membership                                                                |
| `/team/members`        | `manage_org_members`. Role changes owner-only (§3)                                |
| `/team/projects`       | `manage_projects`                                                                 |
| `/team/reclaim`        | `manage_org_members` as the page gate; `canReclaim` is the load-bearing API check |
| `/team/activity`       | Any org membership                                                                |
| `/team/shares`         | `manage_definitions`                                                              |
| `/team/compute`        | `manage_org_compute`. Server-add hidden when `ALLOW_ORG_COMPUTE_OVERRIDE` is off  |
| `/team/settings`       | `manage_org_members`                                                              |

### Auth flow (`/auth/*`)

Public — the round-trip _is_ the credential flow, so no permission check applies.

| Route                     | What it does                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/supabase/start`    | `?provider=google&redirectTo=/app` — mints an OAuth authorize URL and redirects. Requires `SUPABASE_OAUTH_PROVIDERS`.                                    |
| `/auth/supabase/callback` | Exchanges the code for a session and sets cookies. **If no `instance_admin` exists**, the new user is granted every platform permission (bootstrap, §2). |
| `/auth/email/start`       | Magic-link request. `SUPABASE_ALLOW_EMAIL_LINK_SIGNUP` decides whether an unrecognized address may implicitly create an account.                         |
| `/auth/email/callback`    | Consumes the link and establishes the session.                                                                                                           |

---

## 9. Data model invariants

Cheap to lock in now, expensive to retrofit.

**On every tenant-owned entity:** `orgId`, never nullable. This is what makes row-level tenant
isolation (RLS on Postgres) expressible.

**On every mutable entity:** `createdBy` (never changes), `updatedBy`, `createdAt`, `updatedAt`,
`deletedAt` (nullable, soft delete).

**Soft delete is enforced at the data-access layer** — filtered repository methods, DB views, or RLS
policies — never at individual call sites. One missed filter in a route handler is a data leak. Hard
deletion is an admin/background operation over rows past a retention window.

**Request context.** `RequestContext.user` is an _identity_, not necessarily a human — a service
account or share-token-resolved synthetic identity slots in without changing rule signatures.
`actingOrgId` is optional in the type (undefined for instance-admin global reads) but **required at
every handler touching tenant-owned data**, which rejects with 400 when it's missing.

**Definition ownership.** `Definition.ownerId` is non-nullable, set to the uploader, and never
changes. Display metadata in container mode; an access-control input in commons mode. If the owner's
account is deleted the id becomes unresolvable, the UI renders "Deleted user", and the definition
falls to project editors via the moderation path.

**Events.** Every successful mutation emits a domain event (`project.created`,
`definition.published`, `member.removed`, `share_link.minted`, …). `SupabaseEventSink` persists each
to `audit_events` and `/admin/audit` reads them back through `IDataProvider.auditQuery`; the local
provider stays on `NoopEventSink` and the page degrades to its "no backend wired" state. Webhook
dispatch plugs in later as another `IEventSink`.

---

## 10. Offboarding and ownership transfer

- **Disable user (instance-wide)** — `manage_instance_users` sets `disabled=true`. Sessions
  invalidated; identity and attribution preserved.
- **Remove user from org** — org `owner`/`admin` or `manage_org_members`. The user loses every project
  membership in that org but still exists on the instance.
- **Sole-owner projects** — removal is blocked until a new owner is assigned. No silent reassignment.
  If the owner is unreachable, org leadership Reclaims first (§5), then proceeds.
- **Sole instance admin** — revoking, deleting, or disabling the last `instance_admin` returns
  `last_admin`, surfaced as **409** with an actionable message. Revocation is blocked inside
  `IPlatformPermissionStore.set`; delete/disable is blocked by the route calling
  `countInstanceAdminsExcluding` before the auth provider, since the auth provider handles identity
  and knows nothing about Selva permissions. Non-runtime corruption is recoverable via
  `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` (§2).
- **Delete user (hard)** — admin-initiated, through the auth provider. `onUserDeleted` scrubs what FK
  cascade doesn't reach (see [CLAUDE.md](../../CLAUDE.md#data-privacy)). References resolve to
  "Deleted user"; share links the user minted keep working, since they belong to the definition.
- **Org ownership transfer** — explicit action by the current owner. `instance_admin` can
  force-transfer as break-glass.

---

## 11. Scenarios

Sanity checks for the model. Each is covered by a test.

| Scenario                                                                             | Outcome                                                                                                           |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Bob (Acme `member`, no project membership) opens an Acme `private` project.          | **403.** Enforced on view and solve alike.                                                                        |
| Carol (BigClient `member`) opens Acme's `org` project.                               | **403.** `ctx.actingOrgId` doesn't match.                                                                         |
| Bob views/solves an Acme `org` project.                                              | **OK.** Org visibility grants view + solve to every org member.                                                   |
| Bob tries to edit that same `org` project's definition.                              | **403.** `canEditDefinition` needs an explicit project role — org membership is view + solve only.                |
| Marcus (Acme `admin`, no project memberships) opens `/projects`.                     | Sees `org` and `public` Acme projects, **not** private ones he isn't a member of. Reclaim is the escalation path. |
| `instance_admin` opens a private Acme project they're not a member of.               | **403.** Content follows `canView` regardless of platform role (§2, §5). Reclaim first.                           |
| `instance_admin` edits Acme's org settings.                                          | **OK.** Management uses `managementBypassOrRun`.                                                                  |
| Peter (random user) tries to upload `v2` of Alice's definition on a commons project. | **403.** Not the definition owner, not a project editor. "Anyone can contribute" ≠ "anyone can vandalize."        |
| Peter uploads his _own_ new definition to the same commons project.                  | **OK.** `ownerId = Peter`. Alice's work stays untouchable to him.                                                 |
| Alice (project owner) moderates Peter's definition.                                  | **OK.** Project owner/editor keep full moderation authority in commons mode.                                      |
| Alice tries to delete `v1` while it's the live version.                              | **409.** §6 deletion protection — repoint `live` first.                                                           |
| Alice (project `editor`) tries to edit project settings.                             | **403.** Owner only.                                                                                              |
| Alice (Acme `admin`) tries to promote Bob to `admin`.                                | **403.** Role changes are owner-only. She _can_ grant him `manage_projects`.                                      |
| Reclaim done; the new co-owner tries to remove the original owner.                   | `checkOwnerRemoval` → `needs_confirm`; the route 409s until `?confirm=true`.                                      |
| Bob solves 999 times through a 1000-cap share link; the 1000th is rejected.          | **429.** Cap enforced by atomic increment at solve time.                                                          |
| A `draft`-channel share-link holder tries to switch to `live`.                       | **403.** The token pins one channel; step 3 of resolution is strict equality.                                     |
| Alice deletes the definition a share link points at.                                 | Resolution fails closed; hard delete cascades the link out.                                                       |
| An org owner sets `orgDefaults[acme]` to a platform server with `sharedWith: []`.    | **Rejected.** Not in `serversVisibleTo(acme)`; the admin must share it first.                                     |
| An admin un-shares the platform server currently set as `orgDefaults[acme]`.         | The override silently falls through to the global default. No cascade rewrite — defensive resolver behaviour.     |
| A definition is pinned to a server later un-shared from its org.                     | The pin is ignored at solve time and falls through. The UI surfaces the stale pin so an editor can clear it.      |
| The sole `instance_admin` unchecks their own admin permission.                       | **409** `last_admin`; the UI disables the control preemptively.                                                   |
| An Acme member holding a view-only platform-project grant tries to solve.            | **403.** `canSolve` requires `grant.canSolve = true`.                                                             |
| An Acme org admin tries to Reclaim a `platform` project.                             | **403.** `canReclaim` is `false` for `platform` visibility.                                                       |

---

## 12. Deferred (tracked, not built)

Each can ship without breaking the model.

- **Cross-org guests on private projects.**
- **Personal scope outside any org** — a scope belonging to the user, with no org leadership to have
  visibility. The right home for work a user wants entirely to themselves. Until it ships, a private
  org project is the closest thing, but the org owner does hold the Reclaim escape hatch. The existing
  `actingOrgId` discipline carries through with a sentinel or parallel `personalScopeId`.
- **Project transfer between orgs** (the data model already allows it; the UI doesn't).
- **API tokens / service accounts** — distinct from share links, which serve unauthenticated
  end-users. PATs are for authenticated programmatic access.
- **Webhooks** — events already emit; the dispatcher slots in as another `IEventSink`.
- **Per-org data residency / storage backends.**
- **Project templates and bulk member operations** — the pressure valve for flat ACLs at scale.
- **Multi-tenant self-service** — signup, public org creation, plans, quotas, past-due read-only
  state. The data model and the `multi` tenancy switch accommodate it; the user-facing flow and its
  gates are what's missing. Two decisions worth recording now:
  - **Plans are a fourth axis, orthogonal to platform/org/project.** Model them as flags and quotas on
    `Org`, never as permissions or roles. Handlers do `canX(...) && plan.allows('x', count)` — two
    checks, both must pass. This keeps `rules.ts` free of billing concerns.
  - **`/setup` and `/signup` stay separate routes.** `/setup` is staff-seeding: reachable only while
    no `instance_admin` exists, grants every platform permission, and in `single` mode creates the
    first org. A future `/signup` is public account creation with no platform permissions and no org
    side effect. Separate files keep the staff-seed path's narrower attack surface obvious and let a
    deployment disable one without touching the other.

---

## 13. Change discipline

1. **Permissions are extensible; roles are not.** Roles are named bundles — adding one is a schema
   migration and UX churn. Adding a permission is cheap. When in doubt, add a permission and map it
   into the existing roles.
2. **No permission inheritance.** Each project carries its own ACL. Nothing cascades from folders,
   orgs, or templates, and org permissions never leak into project rules.

When in doubt: flat, explicit, one concept per scope.
