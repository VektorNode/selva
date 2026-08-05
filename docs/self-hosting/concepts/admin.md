---
title: Admin Guide
group: Concepts
order: 7
published: false
description: 'Day-to-day operation: registering compute servers, managing users, and the admin surfaces.'
---

# Admin Guide

`/admin` is where you run the instance: users, orgs, the compute pool, updates, and
the audit log. This page is the operator's view. For the authorization model
underneath it, see [Permissions & Organizations](permissions.md).

## Who can reach /admin

You need **any** platform permission to get in: `instance_admin`, `manage_compute`,
`manage_instance_users`, or `manage_updates`. Org-scope permissions don't admit you.
Each section gates itself on top of that, so you see only the tools your permissions
allow. `instance_admin` is the superuser.

## First-run setup

On a brand-new instance with no users, all traffic is redirected to `/setup`.

- **Password / local providers:** `/setup` creates the first user, grants them all
  platform permissions, and in single-tenant mode seeds the default org and
  project. It only renders while no admin exists.
- **OAuth / email-link / header-auth:** there's no `/setup` form. Set
  `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, and the first sign-in matching it is granted
  admin. The policy differs by tenancy:
  - `single` + no env var → the first person to sign in becomes admin.
  - `single` + env var set → only that email qualifies.
  - `multi` → the env var is **required** and must match, so a random first signup
    can't become staff.

`BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is also how you get back in if admin access is
ever lost, after restoring a backup, say, or after an upgrade leaves the database
in a state nobody can administer.

## Sections

### Users (`manage_instance_users`)

Create users, change their permissions, and delete them. You can also add existing
users to the active org, and create and revoke org invites.

Two things to know:

- **Granting platform-scope permissions requires you to already hold
  `instance_admin`**, so an operator with only `manage_instance_users` can't
  self-elevate.
- **Deleting a user is a hard, irreversible erasure.** Rows that point at the user
  go when the user does, but some personal data sits in places that link doesn't
  reach, so it is cleaned up explicitly: on Supabase it deletes
  audit rows the user authored, anonymizes their solve metrics, deletes invites to
  their email, and redacts their email from surviving audit payloads. Delete,
  disable, and permission-removal all refuse with a 409 if they'd remove the last
  instance admin.

### Organizations (`instance_admin`, multi-tenant only)

Lists every org with member counts. You create, rename, and delete orgs through the
admin API. **Deleting an org takes everything under it with it:** org members,
projects, and project members are marked deleted, while pending invites and the
org's compute config are removed outright.
Single-tenant instances hide this section.

### Compute (`manage_compute`)

Register, edit, and remove platform Rhino.Compute servers, set the global default,
and scope each server to specific orgs. Probing a server is a passive read of its
version, plugins, and running workers; it never spawns work. Two actions apply to
the server itself: **purge** clears its cache where it can, and **shutdown** stops
its Rhino worker processes, letting each finish what it is doing first.

On save, an omitted API key is preserved, `null` clears it, and a new value replaces
it. Rotating a key or URL evicts the warm client for that server.

Rotating `SELVA_AT_REST_KEY`, or restoring a backup, leaves stored API keys
undecryptable. The system health check flags this, and the fix is to re-enter the
keys here.

### System

- **Release channel** (`manage_updates`): switch between `stable` and `beta`. This
  only persists the channel, it does **not** trigger an update.
- **Update** (`instance_admin`): runs the package update and restarts the app, with
  output streamed live. A brief downtime is by design. If the new version doesn't
  come up healthy it reverts to the old one by itself, and the whole thing gives up
  after 15 minutes. Beta builds may be unstable, and getting back to stable means switching
  channel and updating again.
- **Health check** (`instance_admin`): verifies at-rest secret decryption, DB schema
  version, default compute reachability, and that `DATA_PATH` is writable.
- **Network probe** (`instance_admin`): measures download and upload throughput.
- Read-only panels show feature flags, resolved compute and upload limits, the
  version, and the current channel.

### Audit (`instance_admin`)

A read-only view of the audit log, loaded a page at a time and enriched with actor
and target names. You can filter by event type (a fixed set of ~25 covering org,
project, member, definition, version, share-link, invite, and system-update
events), by actor id, and by date range. It renders "unavailable" if the provider has no audit query layer.
Remember that deleting a user scrubs their audit rows (see Users).

### Platform Projects (`instance_admin`, `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS`)

List, create, rename, and delete cross-org platform projects, and manage per-org or
per-user access grants, each with a `canSolve` flag. Membership of the host org does
not by itself grant access, because `platform` visibility overrides it. With the
flag off the section isn't there at all.

## Next

- [Permissions & Organizations](permissions.md): the model behind these controls.
- [Security & Limits](security-and-limits.md): secrets, cookies, and the caps.
- [Providers](providers.md): where admin state is stored.
