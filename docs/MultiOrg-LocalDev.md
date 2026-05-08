# Testing Multi-Org Locally

Selva treats organizations as the hard tenancy boundary. Most of that boundary is enforced by store methods comparing `RequestContext.actingOrgId` to the resource's `orgId` ([Permissions.md](../packages/compute-app/specs/Permissions.md)). To exercise that boundary on your machine you need at least two orgs and at least one user per org.

This guide covers both backends — the wiring is provider-agnostic; only the "where the rows land" step differs.

## Tenancy modes

Set in [selva.config.ts](../selva.config.ts) (`tenancy: 'single' | 'multi'`):

| `tenancy`            | Setup creates…                        | Use when                                  |
| -------------------- | ------------------------------------- | ----------------------------------------- |
| `'single'` (default) | One org + the first user as its owner | Single-tenant deploy                      |
| `'multi'`            | Only the platform admin user; no org  | Testing multi-org, or multi-tenant deploy |

`/setup` branches on this — see [setup/+page.server.ts](../packages/compute-app/src/routes/setup/+page.server.ts). In `multi` mode the user lands in the admin without an `actingOrgId` until they're a member of an org.

## Step 1 — Pick a backend

### Option A: Local provider (filesystem JSON)

`selva.config.ts`:

```ts
tenancy: 'multi',
flags: { ALLOW_ORG_CREATION: true }, // optional; lets non-admins create orgs
// auth/data/storage: local.*
```

`.env`:

```bash
DATA_PATH=../../.selva-data
SESSION_SECRET=$(openssl rand -base64 32)
```

### Option B: Supabase (local CLI stack)

Follow the [supabase-provider quick start](../packages/supabase-provider/README.md#quick-start) up to `npx supabase start`, then:

`selva.config.ts`:

```ts
tenancy: 'multi',
flags: { ALLOW_ORG_CREATION: true },
// auth/data/storage: supa.*
```

`.env`:

```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<from supabase status>
SUPABASE_SERVICE_ROLE_KEY=<from supabase status>
SESSION_SECRET=$(openssl rand -base64 32)
```

Both backends share the same compute-app, hooks, admin API, and access rules. From here on everything is identical except the storage step at the end.

## Step 2 — Bootstrap the platform admin

```bash
pnpm dev:compute
```

Hit `http://localhost:3000/setup`, create the first user. They get every platform permission (see [setup/+page.server.ts](../packages/compute-app/src/routes/setup/+page.server.ts)) including `instance_admin`. In `multi` mode no org is created — they're a platform admin floating above tenancy.

## Step 3 — Create orgs

The admin API exists; there's no admin-UI button for it yet. Endpoint: [admin/api/orgs/+server.ts](../packages/compute-app/src/routes/admin/api/orgs/+server.ts) (instance-admin only).

Grab `admin_session` from the browser cookie jar after logging in, then:

```bash
curl -X POST http://localhost:3000/admin/api/orgs \
  -H "Content-Type: application/json" \
  -H "Cookie: admin_session=PASTE_TOKEN" \
  -d '{"name":"Acme","slug":"acme"}'

curl -X POST http://localhost:3000/admin/api/orgs \
  -H "Content-Type: application/json" \
  -H "Cookie: admin_session=PASTE_TOKEN" \
  -d '{"name":"Globex","slug":"globex"}'
```

Each call seeds the caller as the org's `owner` member. Slug must be ≥3 chars, URL-safe.

## Step 4 — Add more users into specific orgs

You want users that are members of _one_ org each, so you can verify isolation by logging in as them.

### Create the users

Either use `/setup` for one and `/admin/users` for the rest (admin-create flow), or use the auth provider's CLI/SQL directly.

### Assign memberships

This is where the two backends diverge.

**Local provider** — edit `$DATA_PATH/local-org.json`. Schema lives in [LocalOrgStore.ts](../packages/local-provider/src/data/LocalOrgStore.ts); `OrgMember` shape is in [types.ts](../packages/platform/src/organizations/types.ts). Append to `orgMembers`:

```json
{
	"orgId": "<acme-uuid>",
	"userId": "<alice-uuid>",
	"role": "member",
	"permissions": [],
	"joinedAt": "2026-04-25T00:00:00.000Z",
	"updatedAt": "2026-04-25T00:00:00.000Z",
	"updatedBy": "<admin-uuid>",
	"deletedAt": null
}
```

Empty `permissions` → the role's defaults apply via `DEFAULT_ORG_PERMISSIONS[role]`. Restart the dev server so the JSON re-reads.

**Supabase** — `psql` into the local stack (`supabase status` for the connection string) and `INSERT` into `public.org_members`. Schema in [0001_initial.sql](../packages/supabase-provider/supabase/migrations/0001_initial.sql):

```sql
insert into public.org_members (org_id, user_id, role, permissions, updated_by)
values ('<acme-uuid>', '<alice-uuid>', 'member', '{}', '<admin-uuid>');
```

The `joined_at`, `updated_at`, `deleted_at` columns default fine.

### Or use the invite flow

If you'd rather not edit storage by hand, the invite endpoint at [api/invites/+server.ts](../packages/compute-app/src/routes/api/invites/+server.ts) issues per-org tokens that `/accept-invite` consumes. The recipient signs up and lands as a member of exactly that org.

## Step 5 — Log in as each user and verify isolation

Open separate browser profiles (or incognito windows):

- `admin@local` → instance admin, sees the first org but bypasses tenancy via the `instance_admin` wrapper
- `alice@acme` → only Acme; should not see Globex's projects/definitions
- `bob@globex` → only Globex

The rule layer documented in [Permissions.md](../packages/compute-app/specs/Permissions.md) is what you're testing. The conformance suites in [packages/local-provider/src/data/**tests**/rules.test.ts](../packages/local-provider/src/data/__tests__/rules.test.ts) cover the same surface programmatically.

## Caveat: there's no org switcher yet

[hooks.server.ts](../packages/compute-app/src/hooks.server.ts) sets `actingOrgId` to **the first org the user is a member of** and stops. The inline comment flags this:

> URL-prefix resolution (`/o/{slug}/...`) will replace this once routes are tenant-namespaced.

So a user with memberships in two orgs will silently always act as the alphabetically-first one. Until tenant-namespaced routes ship, **one user per org** is the cleanest local test setup.
