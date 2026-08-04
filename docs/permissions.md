---
title: Permissions & Orgs
group: Concepts
order: 4
published: true
description: 'How organizations, roles, and per-resource permissions decide who can see and do what.'
---

# Permissions & Organizations

Selva's authorization model has three independent scopes: **platform**, **org**,
and **project**. On top of those sit **share links**, a tokenized path that bypasses
all three. A user's identity (`id`, `email`) carries no permissions of its own —
every grant lives in a store keyed by user id, so an external identity provider
never has to model Selva's authorization.

## Platform scope

Platform permissions are instance-wide operator authority. There are four:

| Permission              | Grants                                               |
| ----------------------- | ---------------------------------------------------- |
| `instance_admin`        | Superuser — implies every other platform permission. |
| `manage_compute`        | Configure the instance-wide Rhino.Compute pool.      |
| `manage_instance_users` | Create, delete, and enable/disable any user.         |
| `manage_updates`        | Run system updates and switch release channel.       |

Regular users hold none of these. Holding any one of them gets you into `/admin`.
Org-scope permissions don't, even though several of those also start with `manage_`.

A hard **sole-admin invariant** applies throughout: the data layer refuses any action
that would leave the instance with zero enabled `instance_admin` users, so it holds
even when the UI is bypassed. `instance_admin` skips _management_ checks such as org
governance and project admin, but **not** _content_ checks — platform staff have to
use "Reclaim" to touch a project's content, and that leaves an audit trail.

## Org scope (multi-tenant)

In multi-org mode, organizations are first-class tenants. Each one has a unique slug,
members, and an owner, which is transferable and distinct from the immutable creator.
Org members have a role and a permission set:

| Role     | Default permissions       |
| -------- | ------------------------- |
| `owner`  | All four org permissions. |
| `admin`  | All four org permissions. |
| `member` | None by default.          |

The four org permissions are `manage_org_members`, `manage_org_compute`,
`manage_definitions`, and `manage_projects`. The first two are governance
permissions and **can never be granted to a `member`**; only `manage_definitions`
and `manage_projects` are member-assignable. The role is the user-facing summary,
but the permission set is what actually gets checked.

Deleting an org soft-deletes it and cascades to org members, projects, and project
members. Pending invites and org compute config are hard-deleted.

## Project scope

Projects belong to an org. Each has a visibility, and a role per member:

- **Roles:** `owner`, `editor`, `viewer`. An owner can delete the project, manage
  members, and change settings. Owners and editors can edit definitions, and
  everyone in scope can view and solve.
- **Visibility:** `private` (only listed members), `org` (any org member), `public`
  (org members only by default, or any authenticated user when
  `SELVA_FLAG_ALLOW_CROSS_ORG_PUBLIC` is on), and `platform` (instance-admin-managed,
  access via platform-project grants).

Removing a project's sole owner is blocked, and one owner removing another needs
confirmation.

**Platform projects** (`visibility: 'platform'`) are cross-org and managed by
instance admins. Access comes from an explicit grant to an org or a user, each
carrying a `canSolve` flag, where `false` means view-only. They need the
`SELVA_FLAG_ENABLE_PLATFORM_PROJECTS` flag.

## Invites

An org member with `manage_org_members` invites an email into their org at a chosen
role. The invite carries the target org, the role, and the org permissions.
Governance permissions are stripped for `member` invites, while owner and admin
invites always get the full default set. Invites expire after **7 days**.

The raw token is the capability. Selva shows it once and stores only an HMAC hash of
it, and the acceptance page (`/accept-invite`) works without a session. Accepting
creates the user — by password or upstream-header identity — and adds them to the
org. New users start with **no platform permissions**.
`SELVA_FLAG_ALLOW_ORG_CREATION` decides whether non-admins can create their own org,
and it's off by default.

## Share links

A share link grants account-free access to exactly one definition on one channel,
either live or draft. It's the one path that bypasses org and project authorization:

- `allowSolve: false` grants view and schema access only, `true` allows solving.
- `maxSolves` caps total solves. It defaults to **1000** when unspecified, and
  `null` uncaps it. Each solve increments the counter atomically, and anything over
  the cap returns **429**.
- `expiresAt` is optional. Links can also be revoked, which is a soft-delete and
  idempotent.

Minting and revoking a link takes the same authority as uploading the definition
(`canEditDefinition`). `SELVA_FLAG_ENABLE_SHARING` gates the whole feature, and
turning it off both blocks the admin routes and stops honouring existing tokens.

## Single- vs multi-tenant

`tenancy: 'single'` collapses the org scope: setup creates one org and every
authenticated user acts within it. `tenancy: 'multi'` makes orgs first-class, so
setup creates only the platform admin and users create their own orgs from there.
Each mode bootstraps the first platform admin differently; see
[the admin guide](admin.md#first-run-bootstrap).

## Next

- [Admin guide](admin.md) — where these grants are managed day to day.
- [Providers](providers.md) — which store backs each of these grants.
