---
title: Permissions & Orgs
order: 4
published: true
description: 'How organizations, roles, and per-resource permissions decide who can see and do what.'
---

# Permissions & Organizations

Authorization has three independent scopes: **platform**, **org**, and **project**. **Share links**
sit outside them and carry their own access in the link. A user's identity (`id`, `email`) carries no
permissions. Every grant lives in a store keyed by user id, so an external identity provider never has
to model Selva's authorization.

## User vs. member

A **user** is an identity that can sign in: an id, an email, and any platform permissions. It belongs
to the instance. Managed at `/admin/users`, behind `manage_instance_users`.

- Deleting a user is irreversible. It removes their account and personal data ([what erasure
  reaches](./data-privacy.md#erasure)); what they made stays, owned by `deleted`.
- Disabling is one-way: no route re-enables an account. It also revokes their API tokens and, for an
  instance admin, their platform permissions.

A **member** is one user's role and permissions _inside one org_. The same user can own one org and
be a plain member of another, so a role belongs to the pairing, not the person. Removing a member
drops that row and leaves the account alone. Managed at `/team/members`, behind `manage_org_members`.

- Anything scoped to an org (role, org permissions, invites) is member vocabulary, even when you reach
  it from the admin side. `/admin/users` shows a user's role in the acting org read-only and links to
  Members & roles to change it.
- Admitting an identity and granting access are separate steps. Where an external IdP owns the
  credential there is nothing to invite, so an admin allowlists the email. Elsewhere the person is
  invited and sets their own password. Either way they arrive as a bare `member` with no permissions.

## Platform scope

Platform permissions are instance-wide operator authority.

| Permission              | Grants                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instance_admin`        | Superuser; bypasses every other platform check. The only permission that can run an update, create an org or change anyone's platform permissions.                                |
| `manage_compute`        | Configure the instance-wide Rhino.Compute pool.                                                                                                                                   |
| `manage_instance_users` | List, create, delete and disable users.                                                                                                                                           |
| `manage_updates`        | Switch the release channel and see the System page in the admin nav. Running the update needs `instance_admin`.                                                                   |
| `manage_api_tokens`     | Mint API tokens of any scope. Without it a user can still mint read, upload and create-project tokens when they could do the same in the browser. Does not admit you to `/admin`. |

The first four admit you to `/admin`. `manage_api_tokens` and org permissions don't, even those
starting with `manage_`.

The data layer refuses any action that would leave the instance with zero enabled `instance_admin`
users, even when the UI is bypassed.

`instance_admin` is a bypass applied at each call site, not a set that expands into the others. On
org projects it skips _management_ checks such as org governance and project admin, but not _content_
checks: platform staff must use "Reclaim" to touch a project's content, which leaves an audit trail.
On platform projects it passes view, solve and edit outright.

## Org scope (multi-tenant)

In multi-org mode each org is a tenant with a unique slug, members, and an owner. An org can have
several owners, and only an owner can grant or remove the `owner` or `admin` role. The creator is immutable.
There is no ownership-transfer flow yet (the button on `/team/settings` is disabled): promote the new
owner instead.

`owner` and `admin` get all four org permissions by default; `member` gets none. The permissions are
`manage_org_members`, `manage_org_compute`, `manage_definitions`, and `manage_projects`. The first two
are governance permissions and **can never be granted to a `member`**. The role is a summary; the
permission set is what gets checked.

Deleting an org marks it, its members, projects, project members and definitions deleted rather than
erasing rows. Pending invites, the org's API tokens and its compute config are removed outright.

## Project scope

Projects belong to an org. Each has a visibility and a role per member.

- **Roles:** `owner`, `editor`, `viewer`. Owners can delete the project, manage members, and change
  settings. Owners and editors edit definitions. Everyone in scope can view and solve.
- **Visibility:**
  - `private`: listed members only
  - `org`: any org member
  - `public`: org members by default, any authenticated user when `SELVA_FLAG_ALLOW_CROSS_ORG_PUBLIC`
    is on
  - `platform`: managed by instance admins, access via platform-project grants

Removing a project's sole owner is blocked. One owner removing another needs confirmation.

**Platform projects** are cross-org. Access comes from an explicit grant to an org or a user, each with
a `canSolve` flag (`false` means view-only). Membership of the host org grants nothing by itself. With
`SELVA_FLAG_ENABLE_PLATFORM_PROJECTS` off they are inaccessible **even to instance admins**, and
`/admin/projects` 404s.

## Invites

A member with `manage_org_members` invites an email into their org at a chosen role. The invite
carries the org, role, and org permissions. Governance permissions are stripped from `member`
invites; owner and admin invites get the full default set. An instance admin can also attach platform
permissions to an invite, and they are granted on accept. Invites expire after **7 days**. Disabling
or removing the person who sent one also kills it.

The raw token is the credential: Selva shows it once and stores only a hash. The acceptance page
(`/accept-invite`) works without a session. A new person creates their account there (by password or
upstream-header identity). An email that already has an account must sign in as that account before
accepting. Accepting adds them to the org, with **no platform permissions** unless the invite carried
them.

## Share links

A share link gives account-free access to one definition on one channel, live or draft. It bypasses
org and project authorization.

- `allowSolve: false` grants view and schema access only. `true` allows solving.
- `maxSolves` caps total solves. Default **1000**; `null` removes the cap. The counter increments
  atomically, so two simultaneous solves can't both take the last slot. Over the cap returns **429**.
- `expiresAt` is optional.
- Revoking marks the link dead instead of deleting it. Revoking twice is harmless.

Minting and revoking take the same authority as uploading the definition (`canEditDefinition`).
`SELVA_FLAG_ENABLE_SHARING` gates the feature. Turning it off blocks the admin routes and stops
honouring existing tokens.

## Single vs. multi-tenant

`tenancy: 'single'` collapses the org scope: setup creates one org and every authenticated user acts
in it. `tenancy: 'multi'` makes orgs first-class: setup creates only the platform admin, and an
instance admin creates each org at `/admin/organizations`. There is no self-service creation.
`SELVA_FLAG_ALLOW_ORG_CREATION` is shown read-only on `/admin/system`, but no route reads it, so
setting it does nothing. The two modes create the first admin differently; see
[the admin guide](../deployment/admin.md#first-run-setup).

## Next

- [Admin guide](../deployment/admin.md): where these grants are managed day to day.
- [Providers](../providers/overview.md): which store backs each grant.
