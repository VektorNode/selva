---
title: Data Privacy
order: 9
published: true
description: 'What personal data a deployment holds, who owns the identity half, what erasure reaches, and where it cannot follow.'
---

# Data Privacy

Selva minimizes the personal data it holds, but it holds some. **The operator is the data controller**
and owns residency, retention, and erasure requests.

## What a deployment stores

On every provider:

- Opaque session tokens (cookies)
- User id + permissions
- Display names (`user_profiles.display_name`)
- Recent runs: each user's last 20 solves, as definition id, definition name and timestamp
- API tokens: owner, scopes, last-used time, and the free-text name the owner chose, which is
  personal data in practice ("Felix laptop")
- Invite email addresses (`invites.email`), kept after accept or expiry

**Supabase only**, because the local data provider discards both:

- Audit-event payloads (`audit_events.data`), which embed an email for `invite.created`
  (see the `DomainEvent` union in `packages/platform/src/events/interface.ts`)
- Solve telemetry (`solve_metrics`), keyed by `actor_id`. It is deliberately **not** FK-cascaded, so
  it survives deletion of the definition or user it refers to.

Login IPs go through the rate limiter but stay in memory, expire within the rate-limit window, and are
never persisted.

## Who owns the identity data

- **Supabase**: credentials, email and sign-in time live in Supabase `auth.users`. Selva holds only the
  authorization data above (plus `user_profiles.last_login_at`).
- **Local**: Selva is the auth provider. `auth-users.json` holds email addresses, PBKDF2 password
  hashes and last sign-in time on the deployment's own disk (`packages/providers/local/src/auth/users.ts`).
- **Header auth**: `header-allowlist.json` holds each user's UPN, email, display name and last sign-in
  time. Credentials stay with your SSO.

See [providers](../providers/overview.md) for the trust boundary.

## Erasure

Deleting a user runs the data provider's `onUserDeleted(ctx, userId, { email })`. The admin delete
handler captures the email before `deleteUser` and passes it through.

**Supabase** (`SupabaseDataProvider`) scrubs what FK cascade doesn't reach:

- deletes `audit_events` the user authored (keyed by plain-text `actor_id`)
- deletes `invites` addressed to their email
- redacts that email from surviving `invite.created` payloads (`redact_audit_event_email`)
- sets `solve_metrics.actor_id` to `'deleted'`, so capacity aggregates survive without the person

**Local** (`LocalDataProvider`, `packages/providers/local/src/data/LocalDataProvider.ts`) has no FK
cascade, so it removes the rows itself:

- deletes their `user-data.json` row (permissions, display name, starred definitions, recent runs)
  and their API tokens
- removes their org and project memberships
- deletes invites they sent or that were addressed to their email, share links they minted, and their
  platform-project grants
- sets `deleted` on the owner, creator, updater and uploader fields of orgs, projects, definitions and
  versions

Erasure removes the person, not what they made. Orgs, projects, definitions and versions stay with
`deleted` in place of the person (on Supabase their `owner_id` or `uploaded_by` goes null, which the
stores read as `'deleted'`). The delete route refuses the only owner of an org: make someone else an
owner, or delete the org, first.

**Open gap:** on Supabase, `audit_events` and `solve_metrics` have no time-based retention. Rows live
until a subject is erased.

## What compute servers receive

A signed-in user's solve of a stored definition carries `X-Session-Id`, an HMAC of the user id and
definition id under `SELVA_HMAC_KEY`, so the compute fork can route it to a warm child. It names no
one, but it links that user's solves of that definition on the server, which for a BYO server may
belong to a third party. A compute build with session affinity keeps it in memory for
`RHINO_COMPUTE_SESSION_TIMEOUT` after the last solve (an hour by default) and logs only an
8-character hash of it; other builds drop it at the proxy.

## Logs are where erasure stops

`onUserDeleted` scrubs rows. It can't reach stdout, which on a real deployment has already shipped to
a collector and may be indexed by a third party. Personal data in a log line outlives every guarantee
above, so never log whole domain objects.

The log redaction list (`packages/server/src/logging/PinoLogger.ts`) matches **credential field
names** (`token`, `apiKey`, ...). It won't catch an email nested in a payload. See
[security & limits § Logging and personal data](../deployment/security-and-limits.md#logging-and-personal-data)
for the matched names and depth.

## Next

- [Security & limits](../deployment/security-and-limits.md): secrets, cookies, and the logging contract.
- [Providers](../providers/overview.md): where identity and credentials live.
- [Admin guide](../deployment/admin.md): the user-deletion flow in the UI.
