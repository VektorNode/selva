---
title: Data Privacy
order: 9
published: true
description: 'What personal data a deployment holds, who owns the identity half, what erasure reaches, and where it cannot follow.'
---

# Data Privacy

Selva minimizes the personal data it holds, but it holds some. **The operator is the data controller**
and owns residency, retention, and erasure requests.

## What every deployment stores

- Opaque session tokens (cookies)
- User id + permissions
- Display names (`user_profiles.display_name`)
- Invite email addresses (`invites.email`), kept after accept or expiry
- Audit-event payloads (`audit_events.data`), which embed an email for `invite.created`
  (see the `DomainEvent` union in `packages/platform/src/events/interface.ts`)
- Solve telemetry (`solve_metrics`), keyed by `actor_id`. It is deliberately **not** FK-cascaded, so
  it survives deletion of the definition or user it refers to.

Login IPs go through the rate limiter but stay in memory, expire within the rate-limit window, and are
never persisted.

## Who owns the identity data

- **Supabase**: credentials and identity live in Supabase `auth.users`. Selva holds only the
  authorization data above.
- **Local**: Selva is the auth provider. `auth-users.json` holds email addresses and PBKDF2 password
  hashes on the deployment's own disk (`packages/providers/local/src/auth/users.ts`).

See [providers](../providers/overview.md) for the trust boundary.

## Erasure

`SupabaseDataProvider.onUserDeleted(ctx, userId, { email })` scrubs what FK cascade doesn't reach. It:

- deletes `audit_events` the user authored (keyed by plain-text `actor_id`)
- deletes `invites` addressed to their email
- redacts that email from surviving `invite.created` payloads (`redact_audit_event_email`)
- sets `solve_metrics.actor_id` to `'deleted'`, so capacity aggregates survive without the person

The admin delete handler captures the email before `deleteUser` and passes it through.

Erasure removes the person, not what they made. Orgs, projects, definitions and versions stay, and
their `owner_id` or `uploaded_by` goes null, which the stores read as `'deleted'`. The delete route
refuses the only owner of an org: make someone else an owner, or delete the org, first.

**Open gap:** `audit_events` and `solve_metrics` have no time-based retention. Rows live until a
subject is erased.

## Logs are where erasure stops

`onUserDeleted` scrubs rows. It can't reach stdout, which on a real deployment has already shipped to
a collector and may be indexed by a third party. Personal data in a log line outlives every guarantee
above, so never log whole domain objects.

The pino redaction list (`packages/server/src/logging/PinoLogger.ts`) matches **credential field
names** (`token`, `apiKey`, ...). It won't catch an email nested in a payload. See
[security & limits § Logging and personal data](../deployment/security-and-limits.md#logging-and-personal-data)
for the matched names and depth.

## Next

- [Security & limits](../deployment/security-and-limits.md): secrets, cookies, and the logging contract.
- [Providers](../providers/overview.md): where identity and credentials live.
- [Admin guide](../deployment/admin.md): the user-deletion flow in the UI.
