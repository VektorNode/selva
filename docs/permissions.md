---
title: Permissions & Orgs
group: Concepts
order: 4
published: true
---

# Permissions & Organizations

Selva's authorization model has three independent scopes — **platform**, **org**,
and **project** — plus **share links**, a tokenized path that bypasses all three.
A user's identity (`id`, `email`) carries no permissions of its own; every grant
lives in a store keyed by user id, so an external identity provider never has to
model Selva's authorization.

## Platform scope

Platform permissions are instance-wide operator authority. There are four:

| Permission              | Grants                                               |
| ----------------------- | ---------------------------------------------------- |
| `instance_admin`        | Superuser — implies every other platform permission. |
| `manage_compute`        | Configure the instance-wide Rhino.Compute pool.      |
| `manage_instance_users` | Create, delete, and enable/disable any user.         |
| `manage_updates`        | Run system updates and switch release channel.       |

Regular users hold none of these. Holding any one admits you to `/admin`; org-scope
permissions do not, even though several also start with `manage_`.

There is a hard **sole-admin invariant**: any action that would leave the instance
with zero enabled `instance_admin` users is refused at the data layer (not just in
the UI). `instance_admin` bypasses _management_ checks (org governance, project
admin) but **not** _content_ checks — platform staff must use "Reclaim" to touch a
project's content, which leaves an audit trail.

## Org scope (multi-tenant)

In multi-org mode, organizations are first-class tenants. Each has an owner (which
is transferable, distinct from the immutable creator), a unique slug, and members.
Org members have a role and a permission set:

| Role     | Default permissions       |
| -------- | ------------------------- |
| `owner`  | All four org permissions. |
| `admin`  | All four org permissions. |
| `member` | None by default.          |

The four org permissions are `manage_org_members`, `manage_org_compute`,
`manage_definitions`, `manage_projects`. The first two are governance permissions
and **can never be granted to a `member`** — only `manage_definitions` and
`manage_projects` are member-assignable. The role is the user-facing summary; the
permission set is what actually gets checked.

Deleting an org soft-deletes it and cascades to org members, projects, and project
members; pending invites and org compute config are hard-deleted.

## Project scope

Projects belong to an org and have a role per member and a visibility:

- **Roles:** `owner`, `editor`, `viewer`. Owner can delete, manage members, and
  change project settings; owner and editor can edit definitions; everyone in scope
  can view and solve.
- **Visibility:** `private` (only listed members), `org` (any org member), `public`
  (org members only by default, or any authenticated user when
  `SELVA_FLAG_ALLOW_CROSS_ORG_PUBLIC` is on), and `platform` (instance-admin-managed,
  access via platform-project grants).

Removing a project's sole owner is blocked; owner-on-owner removal requires
confirmation.

**Platform projects** (`visibility: 'platform'`) are managed by instance admins and
cross-org. Access is by explicit grant to an org or a user, each carrying a
`canSolve` flag (`false` = view-only). They require the `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS`
flag.

## Invites

An org member with `manage_org_members` invites an email into their org at a chosen
role. The invite carries the target org, role, and org permissions (governance
permissions are stripped for `member` invites; owner/admin invites always get the
full default set). Invites expire after **7 days**.

The raw token is the capability — it is shown once, stored only as an HMAC hash, and
the acceptance page (`/accept-invite`) works without a session. Accepting creates
the user (via password or upstream-header identity) and adds them to the org. New
users start with **no platform permissions**. Whether non-admins can create their
own org is gated by `SELVA_FLAG_ALLOW_ORG_CREATION` (off by default).

## Share links

A share link grants account-free access to exactly one definition on one channel
(live or draft). It is the one path that bypasses org/project authorization:

- `allowSolve: false` grants view/schema access only; `true` allows solving.
- `maxSolves` caps total solves (default **1000** when unspecified; `null` uncaps).
  The counter is incremented atomically per solve; over the cap returns **429**.
- Optional `expiresAt`; links can be revoked (soft-delete, idempotent).

Minting and revoking a link requires the same authority that gates uploading the
definition (`canEditDefinition`). The whole feature is gated by `SELVA_FLAG_ENABLE_SHARING` —
turning it off both blocks the admin routes and stops honouring existing tokens.

## Single- vs multi-tenant

`tenancy: 'single'` collapses the org scope: setup creates one org, and every
authenticated user acts within it. `tenancy: 'multi'` makes orgs first-class — setup
creates only the platform admin, and users create their own orgs. The first
platform admin is bootstrapped differently per mode; see
[the admin guide](admin.md#first-run-bootstrap).

## Next

- [Admin guide](admin.md) — where these grants are managed day to day.
- [Providers](providers.md) — which store backs each of these grants.
