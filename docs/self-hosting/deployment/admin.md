---
title: Admin Guide
order: 5
published: true
description: 'Day-to-day operation: registering compute servers, managing users, and the admin surfaces.'
---

# Admin Guide

`/admin` runs the instance. The model underneath is [Permissions & Organizations](../concepts/permissions.md).

## Who can reach /admin

Any platform permission gets you in: `instance_admin`, `manage_compute`, `manage_instance_users` or `manage_updates`. Org-scope permissions don't. Sections then gate themselves:

| Section       | Requires                                                                              |
| ------------- | ------------------------------------------------------------------------------------- |
| Users         | `manage_instance_users`                                                               |
| Organizations | `instance_admin`; hidden in single-tenant mode                                        |
| Compute       | `manage_compute`                                                                      |
| System        | view: any; update: `manage_updates`; health check, throughput probe: `instance_admin` |
| Audit         | `instance_admin`                                                                      |
| Projects      | `instance_admin` + `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS` (404 otherwise)              |

`instance_admin` bypasses management checks at the call site.

## First-run setup

With no users, all traffic redirects to `/setup`.

- **Password / local:** `/setup` creates the first user with all platform permissions (and, single-tenant, the default org and project). It renders only while no admin exists.
- **OAuth / email-link / header-auth:** no form. Set `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`; the first matching sign-in becomes admin (header-auth matches the UPN).
  - `single`, unset: the first sign-in becomes admin.
  - `single`, set: only that email.
  - `multi`: the variable is **required**.

The same variable restores access if admin access is lost.

## Sections

### Users

- Granting platform permissions requires `instance_admin`, so no self-elevation.
- **Deleting a user is irreversible.** Linked rows go with them. On Supabase, audit rows they authored are deleted, solve metrics anonymized, invites to their email deleted, and their email redacted from remaining audit payloads.
- Delete, disable and permission removal return **409** if they'd remove the last enabled instance admin.

### Organizations

**Deleting an org takes everything under it.** Members, projects and project members are marked deleted; pending invites and the org's compute config are removed.

### Compute

Register, edit and remove servers, set the global default, and scope servers to orgs. Probing only reads version, plugins and workers. **Purge** clears the server's cache; **shutdown** stops its Rhino workers after current jobs finish.

On save, an omitted API key is kept, `null` clears it, a new value replaces it. Rotating `SELVA_AT_REST_KEY` or restoring a backup makes stored keys undecryptable; the health check flags it, so re-enter them here.

### System

- **Channel** (`stable` or `beta`): saves the choice only; it does not update.
- **Update:** runs the package update and restarts. The new process has about 30 s to pass its health check (15 probes, 2 s apart), else it rolls back. To leave beta, switch channel and update again.
- **Supabase:** apply migrations **before** updating ([Upgrading later](../providers/supabase.md#upgrading-later)). Updates never run migrations, so a release missing them fails the health check and rolls back every time.
- **Health check:** at-rest decryption, DB schema version, default compute reachability, writable `DATA_PATH`.
- **Throughput probe:** measures bandwidth with incompressible bytes, not reachability.

### Audit

Paged, read-only log with actor and target names. Filter by event type, actor and date. Shows "unavailable" if the provider has no audit query layer.

### Platform Projects

Cross-org projects with per-org or per-user grants, each with a `canSolve` flag. Host-org membership doesn't grant access.

## Next

[Security & Limits](./security-and-limits.md) · [Providers](../providers/overview.md)
