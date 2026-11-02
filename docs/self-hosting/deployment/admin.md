---
title: Admin Guide
order: 7
published: true
description: 'Day-to-day operation: registering compute servers, managing users, and the admin surfaces.'
---

# Admin Guide

`/admin` is where you run the instance: users, orgs, the compute pool, updates, and
the audit log. For the authorization model underneath it, see
[Permissions & Organizations](./permissions.md).

## Who can reach /admin

**Any** platform permission gets you in: `instance_admin`, `manage_compute`,
`manage_instance_users`, or `manage_updates`. Org-scope permissions don't. Each
section then gates itself on top of that:

| Section       | Requires                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Users         | `manage_instance_users`                                                                                             |
| Organizations | `instance_admin`; hidden in single-tenant mode                                                                      |
| Compute       | `manage_compute`                                                                                                    |
| System        | any platform permission to view; `manage_updates` to update; `instance_admin` for health check and throughput probe |
| Audit         | `instance_admin`                                                                                                    |
| Projects      | `instance_admin` + `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS`; 404s otherwise                                            |

`instance_admin` is the superuser: it bypasses management checks at the call site
rather than expanding into the other permissions in the stored set.

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

Under header-auth the same variable is matched against the upstream UPN rather than a
password identity.

`BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is also how you get back in if admin access is ever
lost, after restoring a backup or an upgrade that leaves the database in a state
nobody can administer.

## Sections

### Users (`manage_instance_users`)

Create users, change their permissions, and delete them. You can also add existing
users to the active org, and create and revoke org invites.

- **Granting platform-scope permissions requires `instance_admin`**, so an operator
  holding only `manage_instance_users` can't self-elevate.
- **Deleting a user is a hard, irreversible erasure.** Rows pointing at the user go
  with them; personal data that link doesn't reach is cleaned up explicitly: on
  Supabase, audit rows the user authored are deleted, solve metrics anonymized,
  invites to their email deleted, and their email redacted from surviving audit
  payloads.
- Delete, disable, and permission-removal each return **409** if they'd remove the
  last enabled instance admin.

### Organizations (`instance_admin`, multi-tenant only)

Lists every org with member counts; create, rename, and delete through the admin API.
**Deleting an org takes everything under it:** org members, projects, and project
members are marked deleted, while pending invites and the org's compute config are
removed outright. Single-tenant instances hide this section.

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
  output streamed live. A brief downtime is by design. The new process gets ~30 s to
  pass its health check (15 probes, 2 s apart); if it doesn't, the update rolls back
  to the prior version by itself. Beta builds may be unstable, and getting back to
  stable means switching channel and updating again.

  On Supabase, apply pending migrations **before** updating; see
  [Upgrading later](../providers/supabase.md#upgrading-later). The update never touches
  the database (migrations aren't reversible, so auto-applying them would strand the
  schema ahead of a rolled-back app), so a release whose migrations are missing fails
  its health check and rolls back every time until you run them.

- **Health check** (`instance_admin`): verifies at-rest secret decryption, DB schema
  version, default compute reachability, and that `DATA_PATH` is writable.
- **Throughput probe** (`instance_admin`): measures download and upload bandwidth by
  streaming incompressible bytes. It is not a reachability test.
- Read-only panels show feature flags, resolved compute and upload limits, the
  version, and the current channel.

### Audit (`instance_admin`)

A read-only, paged view of the audit log, enriched with actor and target names.
Filter by event type (a fixed set of 25 covering org, project, member, definition,
version, share-link, invite, and system-update events), by actor id, and by date
range. Renders "unavailable" if the provider has no audit query layer. Deleting a
user scrubs their audit rows (see Users).

### Platform Projects (`instance_admin`, `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS`)

List, create, rename, and delete cross-org platform projects, and manage per-org or
per-user access grants, each with a `canSolve` flag. Membership of the host org does
not by itself grant access, because `platform` visibility overrides it. With the
flag off the section isn't there at all.

## Next

- [Permissions & Organizations](./permissions.md): the model behind these controls.
- [Security & Limits](./security-and-limits.md): secrets, cookies, and the caps.
- [Providers](../providers/overview.md): where admin state is stored.
