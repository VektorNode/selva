# UI Surface Inventory — post access-control refactor

What the backend can now express that the UI doesn't yet expose. Organized by
the role doing the thing, not by the table. Spec source of truth:
[packages/compute-app/src/routes/admin/Permissions.md](../packages/compute-app/src/routes/admin/Permissions.md).

This is a _functional_ inventory — what actions a user needs to perform and
what information they need to see. Layout, copy, and component choice are
explicitly out of scope.

Legend:

- **NEW** — functionality the backend now supports but UI doesn't reach at all.
- **CHANGED** — UI exists but its rules or inputs have shifted.
- **CORRECTNESS** — UI is outdated or wrong vs. the new rules.

---

## 1. Instance admin (platform scope)

> Spec §2. In self-hosted single-tenant this is typically also the org owner;
> the UI should merge views where that's true.

### 1.1 Platform permission management

- **CHANGED** — The admin-users page shows instance-scope permissions to grant.
  The label list was `[platform_admin, manage_users, manage_compute]`; it's now
  `[instance_admin, manage_compute, manage_instance_users, manage_updates]`.
  Need correct names + short tooltips explaining what each actually does.
- **CORRECTNESS** — The old UI let an admin grant `manage_users` at the platform
  level (conflating with org-scope `manage_users`). The new contract is:
  `manage_instance_users` disables/enables users instance-wide; `manage_org_members`
  is a per-org permission not granted through this page.

### 1.2 Instance-wide compute pool

- **CHANGED** — `/admin/compute` already configures the instance compute servers.
  The semantics are now explicitly "instance pool," to distinguish from per-org
  overrides (see 2.7). A small badge or heading clarifying "Instance pool —
  used by every org unless they override" would prevent confusion.
- **NEW** — Surface to the admin whether **BYO compute** (`ALLOW_ORG_COMPUTE_OVERRIDE`)
  is enabled at the platform level, with an indicator showing which orgs have
  configured their own override. Read-only today — the flag is an env var —
  but the visibility itself is missing.

### 1.3 Platform flags dashboard

- **NEW** — A read-only surface showing the resolved state of the three platform
  flags: `ALLOW_CROSS_ORG_PUBLIC`, `ALLOW_ORG_COMPUTE_OVERRIDE`, `ALLOW_ORG_CREATION`.
  The flags come from env, so this isn't an _editor_ — it's a "what's actually
  configured" panel so an admin can tell at a glance why a feature is disabled.

### 1.4 Updates

- **CHANGED** — `/admin/api/system/update` still exists; gate it on `manage_updates`
  (was `platform_admin`). Update the UI nav/visibility accordingly.

### 1.5 Instance user management

- **CHANGED** — The "disable user" action (`AuthUser.disabled`) already exists
  in the backend. UI should let `manage_instance_users` holders disable/enable
  any user on the instance, regardless of org membership. Today the admin users
  page may surface this only for the current org's members.
- **NEW** — Deleting a user (auth-provider-side) should be distinct from
  disabling. Spec §9: deletion is admin-initiated only; the user's ID remains
  referenced as "Deleted user" on historical records. Need: a confirm dialog
  that makes the distinction explicit (disable = reversible, delete =
  permanent + irreversible).

### 1.6 Reclaim escape hatch (covered under org owner/admin, §2.8)

- Instance admin gets all the same affordances as the strictest org owner, via
  the centralized bypass. No new UI beyond what §2.8 needs.

---

## 2. Org owner / admin

> Spec §3. In multi-tenant this is a per-org concept; a user may be owner in
> Acme and member in BigClient. The UI must scope every action to the
> `actingOrgId`.

### 2.0 Platform vs. org admin — surface split

- **STATUS** — Backend leak is **fixed**. The original bug:
  [admin/+layout.server.ts](src/routes/admin/+layout.server.ts) admitted
  anyone holding any of eight admin-class perms (including org-scope ones
  like `manage_org_members`), but the General dashboard
  ([admin/+page.server.ts](src/routes/admin/+page.server.ts)) called
  `auth.listUsers({ limit: 200 })` unconditionally — so an org owner with
  zero platform perms (e.g. Acme's Robert Hayes) saw the **instance-wide
  user total**, plus dead-end "Users"/"Compute" cards that 403'd him, plus
  build/git-hash deployment metadata. The layout now uses
  `assertAnyPlatformPermission` (admits only the four platform perms), and
  the user-count fetch is conditioned on `manage_instance_users`.
- **DIRECTION CHOSEN** — Two alternatives were considered: (1) keep `/admin`
  but make every panel conditional on the right perm and add org-scope
  tabs/cards inside it; (2) split — `/admin` stays platform-only, org admins
  get a sibling surface. **(2) wins.** Going back to a combined route would
  re-introduce the heterogeneous gate we just removed, and a separate route
  pairs naturally with the §2.1 acting-org switcher (switching orgs
  re-scopes the org surface; `/admin` stays anchored to the platform).
- **NEW** — Build the `/team` route (or `/org` — vocabulary preference;
  "team" reads more user-friendly, "org" is more accurate to the data
  model). Layout gates on a new `assertAnyOrgAdminPermission` helper that
  mirrors `assertAnyPlatformPermission` but admits any of the four org
  perms. Sub-pages, each scoped to `actingOrgId` and reusing existing API
  endpoints — no new server logic, just shells:
  - `/team` (general) — org name/slug, member count, "this is the
    `<org>` workspace" header. Always visible to anyone who passes the
    layout gate.
  - `/team/members` — gated `manage_org_members`. Roster + invite form
    (reuses `/api/invites`, the same one `/admin/users` already calls).
    See §2.2, §2.3, §2.5, §2.6.
  - `/team/compute` — gated `manage_org_compute`, **and** only mounted
    when `ALLOW_ORG_COMPUTE_OVERRIDE=true`. BYO compute config. See §2.7.
  - `/team/projects` — gated `manage_projects`. Project list with
    create/reclaim affordances. See §2.8.
  - `/team/settings` — owner-only org settings (name, slug edit, ownership
    transfer, delete). See §2.4.
- **OPEN** — Where the org switcher lives once it ships (§2.1) — most
  natural in the top-bar account menu so it's reachable from both `/admin`
  (platform admins acting on a specific org) and `/team` (org admins
  switching between their orgs). Not blocking; just flag the placement
  call when scaffolding.

### 2.1 Acting-org switcher

- **NEW** — The UI currently assumes one active org. With multi-tenant on the
  horizon, a user may belong to several orgs. Need: a picker (top bar / account
  menu) that sets `ctx.actingOrgId`, and every listing + action downstream
  reflects that choice. Spec §1 + §8 reinforce this is the _only_ correct
  tenancy check primitive.

### 2.2 Org roster + role management

- **CHANGED** — Role options are `owner / admin / member` (unchanged), but the
  per-role default permissions have renamed: `manage_org_members`,
  `manage_org_compute`, `manage_definitions`, `manage_projects`. The UI should
  show which permissions each role currently holds, and allow grants of
  `manage_definitions` / `manage_projects` to individual members.
- **CORRECTNESS** — `manage_org_members` and `manage_org_compute` are **not
  grantable to `member`** (spec §3, `OWNER_ADMIN_ONLY_PERMISSIONS`). The UI
  must hide those two checkboxes when the selected role is `member` or refuse
  to submit if they're checked.

### 2.3 Invites

- **CHANGED** — Invite management is gated on `manage_org_members` (was
  `manage_users`). The existing invite UI works; just needs the gate update.
- **NEW** — Spec §11 tracks "cross-org guest on a private project" as deferred.
  Nothing to do yet; flag this in UI only if/when we build it.

### 2.4 Create / edit / delete org

- **NEW** — `ALLOW_ORG_CREATION` flag decides whether signed-in users see a
  "Create organization" action. When off (self-hosted default), the action
  should not appear. When on, a simple create flow sets the caller as `owner`.
- **CHANGED** — Org settings editable by `manage_org_members` holders: name,
  slug. Deletion is org-owner-only; UI should hide delete from admins.
- **NEW** — Ownership transfer. Spec §9 says transfer is an explicit action by
  the current owner; instance_admin can force. The UI needs a "Transfer
  ownership" affordance on the org settings page.

### 2.5 Offboarding a user from the org

- **NEW** — Remove member flow should surface the sole-owner-of-project block
  (spec §9). When the removal would orphan projects, the UI must:
  1. Block the removal.
  2. List the orphan projects.
  3. Offer a **"Reclaim + reassign"** step (org owner/admin adds themselves as
     co-owner, then removes the original) — this is the manual escape hatch
     we locked in.

### 2.6 Disable vs. remove

- **CORRECTNESS** — Org admins **cannot** disable a user (that's instance-wide
  per §2/§9). They can remove from _their_ org. The UI must not expose a
  "disable" button on the org member list.

### 2.7 Per-org compute override (BYO compute)

- **NEW** — When `ALLOW_ORG_COMPUTE_OVERRIDE` is on at the platform level,
  holders of `manage_org_compute` see a "Compute server" section in org
  settings letting them configure:
  - Rhino.Compute URL + API key.
  - Timeout / retry hints.
  - "Use instance default" toggle (sets the override to null).
  - A read-only note showing which server solves currently route to, so
    misconfigurations are obvious.
- **NEW** — When the platform flag is off, the section hides entirely — the
  permission is inert.

### 2.8 Project reclaim

- **NEW** — On any project in the org, org owner/admin see a **"Reclaim"**
  action (spec §5 `canReclaim`). Semantics:
  - Adds the actor as co-owner of the project.
  - Does **not** demote the existing owner.
  - Surfaces a confirm dialog stating "this will be recorded" (the audit hook
    will log it once audit ships).

---

## 3. Project owner

> Spec §4 + §5. Distinct from org owner — a project owner is specific to a
> project and may or may not hold broader org authority.

### 3.1 Project settings

- **CHANGED** — Settings page now has strictly owner-only editability (spec §5,
  `canEditProjectSettings`). The old "project editor + manage_definitions can
  edit" affordance is gone. UI must hide the edit controls for non-owners.
- **NEW** — New editable field: `autoJoinOnUpload` (commons toggle).
  - Disabled in the UI unless `visibility === 'public'`. Flipping visibility
    off `public` should either confirm clearing the flag or reject the change.
  - Short explanation of the Alice/Peter trust model: commons projects let any
    authenticated user upload a definition they then own; project editors
    retain moderator authority over everyone's contributions.
- **NEW** — Anonymous access (iframe embeds, share-by-URL) is delivered via
  per-definition share links (Permissions.md §7), minted from the definition
  page. There is **no project-level toggle** for anonymous access. See §8 for
  the share-link UI surface.
- **NEW** — Changing visibility **to `public`** is a stricter action
  (canChangeVisibilityToPublic). The UI should:
  1. Show the option only to org owner/admin (not project owner alone).
  2. If `ALLOW_CROSS_ORG_PUBLIC` is off, grey out / hide the option with a
     tooltip explaining the platform-level gate.
  3. Show a "this will be visible to the whole instance" confirm before
     committing.

### 3.2 Project deletion

- **CORRECTNESS** — Only owner and instance_admin can delete. UI hides the
  button otherwise.
- **NEW** — Delete is now **soft** — a retention sweep hard-deletes later. The
  confirm dialog should say "will be removed from view immediately; permanent
  deletion in N days" (honest UI; matches the data layer).

### 3.3 Project members

- **CHANGED** — Add-member dialog: the target user **must be an org member
  first** (spec §4). The UI should search the org roster, not accept free-form
  emails. Cross-org guests are deferred (§11); don't expose that path.
- **NEW** — Role choices are `owner / editor / viewer`. `viewer` needs a short
  tooltip explaining "can view/solve but not modify" since it wasn't
  prominently surfaced before.
- **NEW** — Owner-on-owner removal confirm (spec §5). When the current user is
  owner and tries to remove another owner, an extra confirm step appears
  (prevents accidental lockouts after a reclaim).
- **NEW** — "Transfer ownership" action — pass owner role to another member in
  one click. Drops the current owner to editor (or leaves them as owner if
  they want co-ownership).

### 3.4 Sole-owner offboarding (interaction with org roster)

- **NEW** — If the project owner is about to be removed from the parent org
  (via §2.5), the project UI should surface the pending-removal state so the
  owner knows what's coming. Optional polish.

---

## 4. Project editor

Nothing new to surface specifically for `editor`; spec §4 behavior is the same
as before. Just two cleanups:

- **CORRECTNESS** — Editor no longer sees project-settings edit. Hide the
  controls unless the current member role is `owner`.
- **CORRECTNESS** — "Edit definition" now always works for editors regardless
  of project visibility (Permissions.md §5, `canEditDefinition`). Any UI logic
  that previously grayed out the edit action on public projects for
  non-uploaders was wrong; remove it.

---

## 5. Project viewer

> Introduced as a first-class role (kept after discussion — clients /
> stakeholders need this).

- **NEW** — Viewer role exists in the data model but may not have UI yet.
  Needs:
  - Adding a user as `viewer` from the members dialog (3.3).
  - Viewer badge on the member list, distinct from editor.
  - Viewer-only project pages: schema visible, solve form works, download
    results works, but every edit affordance is hidden (no upload, no
    metadata edit, no member management).

---

## 6. Definition authoring (container model)

> Default projects — `autoJoinOnUpload=false`.

- **CHANGED** — Upload controls available only to project owner/editor. The
  old rule "anyone with `manage_definitions` in the org can upload to a public
  project" is gone. UI should hide the upload button for non-members.
- **NEW** — Display `createdBy` and `updatedBy` on the definition detail view
  ("uploaded by Alice; last edited by Bob 3 days ago"). Permissions.md §9
  mandates the fields on every mutable entity; they're not rendered today.

---

## 7. Definition authoring (commons model)

> Projects with `autoJoinOnUpload=true`. Alice/Peter walkthrough is the
> acceptance scenario (spec §10).

### 7.1 Upload flow

- **NEW** — On a commons project, the **Upload** button is visible to _any
  authenticated user_ on the instance. The button should label/hint explain
  "Create a new shared script — you'll be its owner and can edit/delete it."
- **NEW** — After upload, the user sees their own definition listed with
  "Owned by me" indicator; commons ownership is first-class here.

### 7.2 Per-definition edit rights

- **CHANGED** — Every definition in a commons project shows its `ownerId`. Edit
  and delete affordances appear **only** on definitions the current user owns
  (+ to project editors as moderators).
- **NEW** — If a non-owner non-editor opens a definition, the UI explains why
  edit is unavailable ("Uploaded by @alice — only the uploader or project
  editors can change it").

### 7.3 Moderation (project editor view)

- **NEW** — Project editors in a commons project should see an admin-style
  indicator on _everyone's_ definitions: "You can moderate this" + a Delete
  button. Distinguishes moderation intent from ownership-edit.

---

## 8. Share-link management

> Permissions.md §7. Backend is fully wired (mint, list, revoke, atomic
> solve-count enforcement). Zero UI surface today — this is the largest
> gap from a user-visible-functionality standpoint.

Per-definition tokens that grant access to one (definition, channel) pair
without requiring an account. Replaces both "share-by-link" and "anonymous-
embed" use cases. Authorization to mint mirrors `canEditDefinition` —
container-mode editors and commons-mode definition owners both qualify.

### 8.1 Mint a share link

- **NEW** — On any definition the current user can edit, surface a "Share"
  action that opens a mint dialog with:
  - **Channel** picker — `live` (default) or `draft`. `draft` warns "reviewers
    will see the unpublished version."
  - **Allow solve** toggle — off = view-only schema; on = full solve.
  - **Expiry** — optional ISO date / "never expires."
  - **Solve cap** — pre-filled with the default (`DEFAULT_SHARE_LINK_MAX_SOLVES`,
    currently 1000). Removing or raising the cap requires an extra confirm
    step (the design assumes leakage; an uncapped iframe is a denial-of-
    wallet vector).
  - **Optional label** — `name?` field for distinguishing links in the list.
- **NEW** — On submit, surface the **raw token exactly once** with a copy
  button and a clear "this is the only time you'll see it" warning. The
  backend hashes on store; we genuinely cannot re-derive it.

### 8.2 List existing links per definition

- **NEW** — Tab or panel on the definition detail page showing every active
  - revoked link: label, channel, allow-solve flag, cap, current count,
    expiry, mint date, mint user. No raw token.
- **NEW** — Per-row affordances:
  - **Revoke** — soft-delete (sets `revokedAt`); cannot be undone.
  - **Copy URL** — re-derives the share URL from the link id (sans token —
    only useful as a reference, NOT a working link). Or omit; raw token is
    only shown at mint.

### 8.3 Anonymous iframe embed

- **NEW** — On the same definition page, an "Embed" affordance that mints a
  share link (or selects an existing one) and produces a copy-pasteable
  iframe snippet pre-filled with `?token=…`. Flag the snippet with a
  warning banner: "This URL grants the configured solves to anyone who
  receives it; revoke immediately if compromised."

### 8.4 Cap-reached and revoked states for consumers

- **NEW** — When a token-resolved request returns 429 (cap reached) or 401
  (revoked / expired), the embedded solve page should render a clear,
  branded "this share link is no longer active" state rather than a raw
  error. Pure copy + UI work; backend already returns the correct codes.

---

## 9. Definition versioning (scaffold only)

> Permissions.md §6. Data model exists; no upload/publish UI is wired yet.

- **NEW (future)** — Version list per definition (`liveVersionId`,
  `draftVersionId`, plus a historical timeline).
- **NEW (future)** — "Publish draft → live" button (editors/owners).
- **NEW (future)** — "Roll back to v1" affordance on any prior version.
- **NEW (future)** — Consumers see which version they're solving; `?channel=draft`
  URL param surfaces "You're viewing the unpublished draft" banner to editors.
- **NOT NOW** — Actual UI is blocked on the publish-flow implementation (a
  later PR). But if a user lands on the version list before that, we should
  render a "coming soon" placeholder rather than crash. A small read-only
  "versions" page can show the new `liveVersionId` / `draftVersionId` raw
  values today — useful for debugging, optional.

---

## 10. Solve / view (the consumer-facing app)

### 9.1 Visibility-aware listing

- **CORRECTNESS** — The `/app` home lists definitions. The list must reflect
  `canView` correctly — including rejecting private projects the user isn't a
  member of, which the existing UI already does. No change _if_ it was right
  before; worth an audit pass now that `canSolve` actually enforces visibility.
- **NEW** — When no projects are accessible (e.g., a brand-new user on a
  multi-tenant instance), an empty state explaining "You're not in any
  project yet — ask an admin for access" with next-step copy.

### 9.2 Solving private/org projects

- **CHANGED** — The solve endpoint now rejects unauthenticated and
  out-of-scope callers correctly (A1/A2). No UI change needed, but:
- **NEW** — A 403 from `/api/compute` should surface cleanly in the solve UI
  with a clear "You don't have access to this definition" message instead of
  a generic error toast. Today the endpoint surfaces the error body; the
  client probably needs copy improvements.

### 9.3 Anonymous iframe embeds

- Delivered via per-definition share links (Permissions.md §7). The minter
  pastes the link's URL into an iframe; the token in the URL authenticates
  the embed. Caps and revocation are the load-bearing protections. All UI
  work is enumerated in §8.

---

## 11. Audit and attribution (rendering concerns)

These are **display-only** items enabled by the audit fields on every mutable
entity (Permissions.md §9). None require new endpoints; they're read-only
surfacings of data that now exists.

- **NEW** — "Created by" / "last updated by" display on project, org,
  definition pages.
- **NEW** — "Deleted user" rendering everywhere a `userId` might no longer
  resolve (Permissions.md §9). The backend already leaves orphan IDs in place
  — the frontend needs a safe fallback component.
- **NEW (future)** — Audit log **viewer UI**. Storage is live (every domain
  event is persisted to `public.audit_events` via `SupabaseEventSink`); only
  the operator-facing browser is deferred (Permissions.md §12). Tracked in
  the deferred list below.

---

## 12. Deferred features — UI tracking

For completeness, features designed-for in the spec but without UI yet. If a
user asks "where's X?" we should have consistent "coming soon" placeholders
rather than ad-hoc empty states.

- Reclaim audit trail (§2.8) — action exists, audit row IS now persisted to
  `audit_events`; only the operator-facing browser is deferred.
- **Share-by-link UI is no longer deferred** — backend is fully wired and
  the UI work is enumerated in §8 above. Removed from this list.
- Cross-org project guests (Permissions.md §12) — not built.
- **Audit log VIEWER UI** (Permissions.md §12). Storage IS live: every domain
  event is persisted to `audit_events` via `SupabaseEventSink` — the data is
  accumulating from day one. What's deferred is the operator-facing surface
  for browsing it (filter by actor, type, time window; resolve `actorId` to a
  display name; render the JSONB payload).
- API tokens / PATs (Permissions.md §12) — not built.
- Webhooks (Permissions.md §12) — events emit, no dispatcher; UI for managing
  webhook endpoints lands later.
- Cross-org guest on a private project (Permissions.md §12) — not built.
- Per-org data residency (Permissions.md §12) — not built.
- Project templates / bulk member ops (Permissions.md §12) — not built.

---

## Priorities for a first UI pass

If you want to sequence this, my recommendation:

1. **CORRECTNESS fixes first.** Anything labelled `CORRECTNESS` in this doc is
   a bug — the UI shows actions that now 403 at the server, or vice versa.
   Silent but ugly.
2. **Acting-org switcher** (§2.1). Every multi-tenant flow depends on it.
3. **Share-link management** (§8). Backend is fully wired; this is the largest
   shippable user-visible feature with zero current UI surface. Also unblocks
   anonymous-embed iframes that the doc previously deferred.
4. **Project flag editors** (§3.1). The backend enforces, but there's no way
   for a user to turn them on.
5. **Commons model affordances** (§7). The most user-visible new behavior.
6. **Reclaim + offboarding flows** (§2.5, §2.8). These are the enterprise
   safety net; shipping without them is embarrassing when the first real
   customer asks.
7. **Attribution display** (§11). Low effort, high "feels professional" value.
8. **Viewer role UI** (§5). Unblocks the client-review use case you wanted.
9. Everything else can wait for real demand.
