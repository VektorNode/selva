---
title: Admin Guide
order: 5
published: true
description: 'Day-to-day operation: registering compute servers, managing users, and the admin surfaces.'
---

# Admin Guide

`/admin` runs the instance. The model underneath is [Permissions & Organizations](../concepts/permissions.md).

## Who can reach /admin

Any of `instance_admin`, `manage_compute`, `manage_instance_users` or `manage_updates` gets you in. `manage_api_tokens` and org permissions don't. Sections then gate themselves:

| Section       | Requires                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Users         | `manage_instance_users`                                                                                  |
| Organizations | `instance_admin`; hidden in single-tenant mode                                                           |
| Compute       | `manage_compute`                                                                                         |
| System        | nav link and release channel: `manage_updates`; update, health check, throughput probe: `instance_admin` |
| Audit         | `instance_admin`                                                                                         |
| Projects      | `instance_admin` + `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS` (404 otherwise)                                 |

## First-run setup

With no users, non-public pages redirect to `/setup` and `/api` calls return 503 `SETUP_REQUIRED`.

- **Password / local:** `/setup` creates the first user with all platform permissions (and, single-tenant, the default org and project). It works only while no admin exists, and only through the setup link: `npx selva setup-url` prints it on the server. The link carries a token derived from `SELVA_HMAC_KEY`, because a password form cannot prove the email typed into it. With `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` set, the email must match as well.
- **OAuth / email-link / header-auth:** no form. The first sign-in that proves it is the operator becomes admin:
  - `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` set: a sign-in with that email. The identity provider has proven it; header-auth matches the email, else the UPN.
  - Unset: a sign-in from a browser that opened the setup link first. The link is remembered in a cookie for an hour, so an email link has to be opened in the same browser. Anyone else gets no admin.

On those providers the variable also restores access: while no instance admin exists, the next matching sign-in is promoted. Local password auth never runs the bootstrap.

## Sections

### Users

- Granting platform permissions requires `instance_admin`, so no self-elevation.
- Delete, disable and permission removal return **409** if they'd remove the last enabled instance admin.
- Deletion is irreversible; [what it erases](../concepts/data-privacy.md#erasure).

### Organizations

Deleting an org takes everything under it: see [Org scope](../concepts/permissions.md#org-scope-multi-tenant).

### Compute

Register, edit and remove servers, set the global default, and scope servers to orgs. Probing only reads version, plugins and workers. **Purge** clears the server's cache; **shutdown** stops its Rhino workers after current jobs finish.

On save, an omitted API key is kept, `null` clears it, a new value replaces it. Rotating `SELVA_AT_REST_KEY` or restoring a backup makes stored keys undecryptable; the health check flags it, so re-enter them here.

### System

- **Channel** (`stable` or `beta`): saves the choice only; it does not update.
- **Update:** runs the package update and restarts. The new process has about 30 s to pass its health check (15 probes, 2 s apart), else it rolls back. To leave beta, switch channel and update again; the update is refused when the stable release cannot read your data ([Going back to an older release](#going-back-to-an-older-release)). Only `instance_admin` can run it, though the page shows the button to `manage_updates` holders too.
- **Supabase:** apply migrations **before** updating ([Upgrading later](../providers/supabase.md#upgrading-later)). Updates never run migrations, so a release missing them fails the health check and rolls back every time.
- **Health check:** at-rest decryption, DB schema version, default compute reachability, writable `DATA_PATH`, the proxy and body-limit variables, and (Supabase) the API-token signing key.
- **Throughput probe:** measures bandwidth with incompressible bytes, not reachability.

#### Going back to an older release

Each release declares a data format. A release on a lower format than the installed one cannot read what the deployment has stored, so the update is refused before the app stops. This happens when the stable release is older than the beta you are on. Staying on the beta until the next stable release needs no action: switch the channel back to `beta`.

To go back anyway, from data format 2 (4.21.0) to format 1 (4.20.0 and older):

1. On the installed version, clear every Compute API key at `/admin/compute`. Format 1 cannot read keys format 2 has stored.
2. In the deployment directory: `npm install --save @selvajs/cli@<version> @selvajs/selva@<version>`, then `npx selva restart`.
3. Re-enter the keys at `/admin/compute`.

Database migrations are never reversed, on any provider.

### Audit

Paged, read-only log with actor and target names. Filter by event type, actor and date. The local provider records no audit events, so the page is unavailable there.

### Platform Projects

Create cross-org projects and manage their grants. Rules: [Project scope](../concepts/permissions.md#project-scope).

The Supabase provider has no platform projects. Leave `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS` off there: with it on, provider setup fails with an error naming the flag, and no page loads.

## Next

[Security & Limits](./security-and-limits.md) · [Providers](../providers/overview.md)
