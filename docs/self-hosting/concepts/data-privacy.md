---
title: Data Privacy
order: 9
published: true
description: 'What personal data a deployment holds, who owns the identity half, what erasure reaches, and where it cannot follow.'
---

# Data Privacy

**Selva minimizes the personal data it holds, but it does hold some, and the operator is
the data controller**, responsible for residency, retention, and erasure requests.

This page is the full inventory: what is stored, who owns the identity data, what erasure
reaches, and where it cannot follow.

## What every deployment stores

- Opaque session tokens (cookies)
- User id + permissions
- Display names (`user_profiles.display_name`)
- Invite email addresses (`invites.email`), retained after accept or expiry
- Audit-event payloads (`audit_events.data`), which embed an email for `invite.created`
  (see the `DomainEvent` union in `packages/platform/src/events/interface.ts`)
- Solve telemetry (`solve_metrics`), keyed by `actor_id` and deliberately **not**
  FK-cascaded, so it survives deletion of the definition or user it refers to

Login IPs are processed by the rate limiter but stay in memory, expire within the
rate-limit window, and are never persisted.

## Who owns the identity data

How much the auth provider owns depends on which one runs:

- **Supabase**: credentials and identity live in Supabase `auth.users`; Selva holds only
  the authorization data above. This is the case the "provider owns it" framing describes.
- **Local**: **Selva _is_ the auth provider.** `auth-users.json` holds email addresses and
  PBKDF2 password hashes on the deployment's own disk
  (`packages/providers/local/src/auth/users.ts`). No third party, no credential-isolation
  claim.

See [providers](../providers/overview.md) for the full trust boundary.

## Erasure

`SupabaseDataProvider.onUserDeleted(ctx, userId, { email })` scrubs what FK cascade doesn't
reach: deletes `audit_events` the user authored (keyed by plain-text `actor_id`) and
`invites` addressed to their email, redacts that email from surviving `invite.created`
payloads (`redact_audit_event_email`), and tombstones `solve_metrics.actor_id` to
`'deleted'` so the row survives for capacity aggregates while the person does not. The
admin delete handler captures the email before `deleteUser` and passes it through.

**Open gap:** no time-based retention on `audit_events` or `solve_metrics`; rows live
until a subject is erased.

## Logs are the escape hatch erasure cannot follow

`onUserDeleted` scrubs rows; it has no reach into stdout, which on a real deployment has
already shipped to a collector and may be indexed by a third party. A log line carrying
personal data outlives every guarantee above, hence the project rule against logging whole
domain objects.

The pino redaction list (`packages/server/src/logging/PinoLogger.ts`) scrubs by
**credential field name** (`token`, `apiKey`, …) and will **not** catch an email nested in a
payload; it is a backstop for accidents, not a licence to log objects. See
[security & limits § Logging and personal data](./security-and-limits.md#logging-and-personal-data)
for exactly which field names are matched and at what depth.

## Next

- [Security & limits](./security-and-limits.md): secrets, cookies, and the logging contract.
- [Providers](../providers/overview.md): where identity and credentials actually live.
- [Admin guide](./admin.md): the user-deletion flow in the UI.
