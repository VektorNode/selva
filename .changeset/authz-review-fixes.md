---
'@selvajs/server': minor
'@selvajs/selva': patch
---

- Resending an invite runs the same owner-only and platform-permission gates as minting one: an admin could resend an owner invite and accept the link it returned.
- Invites can't be created or resent with an API key. An accepted invite is an account that outlives a revoked key.
- Only the org owner can change an owner's or admin's permissions. A member PATCH now runs every check before writing, so a refused permission set no longer leaves a role change behind.
- Member role changes and removals in one org run one at a time, so two owners removing each other can't leave the org with none (per process).
- `safeRedirectTarget` refuses control characters: browsers strip `\t` from `/\t/evil.com`, which then redirects to `//evil.com`.
- OAuth: a client asking only for scopes it may not have gets `read`, not every scope it is allowed.
- `parseBody` answers broken JSON with 400. Only an empty body falls back to `missingAs`, so a truncated rollback can't publish the draft.
- `readForm` answers a body that isn't a form with 400, not a 500.
- Cover images are type-checked before anything is written, and a definition whose image fails to save is removed instead of left behind.
- The idempotency store has a byte budget (`maxWeight`, 256 MB for API stores) on top of its key cap. A retry that joined an attempt ending in 499 runs again instead of inheriting it. Solve replays are keyed per response encoding and charged to the key's rate limit.
- `assertScopeAnywhere`: cancelling a solve and opening the solve-event stream need the action on any resource, so a project-scoped key can stop and watch its own solves.
- `POST /api/v1/compute/schema` answers refused access with 401, 403 or 404 instead of 500.
