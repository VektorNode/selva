---
title: Admin Guide
group: Concepts
order: 7
published: true
description: 'Day-to-day operation: registering compute servers, managing users, and the admin surfaces.'
---

# Admin Guide

The `/admin` area is where an operator runs the instance: users, orgs, the compute
pool, updates, and the audit log. This is the operator's view; the underlying
authorization model is in [Permissions & Organizations](permissions.md).

## Who can reach /admin

Access requires holding **any** platform permission (`instance_admin`,
`manage_compute`, `manage_instance_users`, or `manage_updates`). Org-scope
permissions do not admit entry. Each section further gates itself — you see the
tools your permissions allow. `instance_admin` is the superuser.

## First-run bootstrap

On a brand-new instance with no users, all traffic is redirected to `/setup`.

- **Password / local providers:** `/setup` creates the first user, grants them all
  platform permissions, and (in single-tenant mode) seeds the default org and
  project. It only renders while no admin exists.
- **OAuth / email-link / header-auth:** there is no `/setup` form. Set
  `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` and the first matching sign-in is granted admin.
  The policy differs by tenancy:
  - `single` + no env var → the first person to sign in becomes admin.
  - `single` + env var set → only that email qualifies.
  - `multi` → the env var is **required** and must match, so a random first signup
    can't become staff.

`BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is also the break-glass recovery path if admin
access is ever lost (e.g. a backup restore or migration drift).

## Sections

### Users (`manage_instance_users`)

Create users, change their permissions, and delete them; add existing users to the
active org; create and revoke org invites.

Two things to know:

- **Granting platform-scope permissions requires you to already hold
  `instance_admin`** — a `manage_instance_users`-only operator can't self-elevate.
- **Deleting a user is a hard, irreversible erasure.** It removes the identity and
  scrubs personal data that foreign-key cascade can't reach: on Supabase it deletes
  audit rows the user authored, anonymizes their solve metrics, deletes invites to
  their email, and redacts their email from surviving audit payloads. Delete,
  disable, and permission-removal all refuse (409) if they would remove the last
  instance admin.

### Organizations (`instance_admin`, multi-tenant only)

Lists every org with member counts. Creating, renaming, and deleting orgs is done
through the admin API. **Deleting an org cascades** — org members, projects, and
project members are soft-deleted; pending invites and org compute config are
hard-deleted. Single-tenant instances hide this section.

### Compute (`manage_compute`)

Register, edit, and remove platform Rhino.Compute servers, set the global default,
and scope each server to specific orgs. You can probe a server (a passive read of
version, plugins, and active children — it never spawns work) and run fleet
actions: **purge** (best-effort cache purge) or **shutdown** (graceful shutdown of
all child processes). On save, an omitted API key is preserved, `null` clears it,
and a new value replaces it; rotating a key or URL evicts the warm client for that
server.

A rotated `SELVA_AT_REST_KEY` (or a restored backup) makes stored API keys
undecryptable — the system health check flags this, and the fix is to re-enter the
keys here.

### System

- **Release channel** (`manage_updates`): switch between `stable` and `beta`. This
  only persists the channel — it does **not** trigger an update.
- **Update** (`instance_admin`): runs the package update and restarts the app,
  streamed live. There is a brief downtime by design, an automatic rollback if the
  new process fails a health probe, and a 15-minute hard timeout. Beta builds may be
  unstable; reverting to stable is a channel switch plus an update.
- **Health check** (`instance_admin`): verifies at-rest secret decryption, DB schema
  version, default compute reachability, and that `DATA_PATH` is writable.
- **Network probe** (`instance_admin`): measures download/upload throughput.
- Read-only panels show feature flags, resolved compute/upload limits, version, and
  the current channel.

### Audit (`instance_admin`)

A read-only view of the audit log (cursor-paginated), enriched with actor and target
names. Filter by event type (a fixed allowlist of ~25 org/project/member/definition/
version/share-link/invite/system-update events), by actor id, and by date range.
Renders "unavailable" if the provider has no audit query layer. Note that deleting a
user scrubs their audit rows (see Users).

### Platform Projects (`instance_admin`, `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS`)

List, create, rename, and delete cross-org platform projects, and manage per-org or
per-user access grants (each with a `canSolve` flag). Host-org membership does not
grant access — `platform` visibility overrides it. The section 404s when the flag is
off.

## Next

- [Permissions & Organizations](permissions.md) — the model behind these controls.
- [Security & Limits](security-and-limits.md) — secrets, cookies, and the caps.
- [Providers](providers.md) — where admin state is stored.
