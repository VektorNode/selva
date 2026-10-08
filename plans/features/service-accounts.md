# Service accounts

**Status: designed, not built.** Follows the door [token-plan.md](token-plan.md) left open.

An API token acts as the user who minted it. When that member leaves, the lifecycle rules revoke
their keys and the ERP integration they set up stops. A **service account** (CONTEXT.md: "a user
that cannot log in, existing only to own API tokens for an integration that should outlive the
person who set it up") gives the org a key owner that never leaves.

## Decisions

### A service account is a user row

- **It is a real user** (`auth.users` on Supabase, a user record on local) plus one row in
  `selva.service_accounts`. Every FK, RLS policy, delegated session and `buildRequestContext` call
  already speaks user ids, so nothing downstream learns a new principal type. This is the reason
  `api_tokens` split `user_id` (acts as) from `created_by` (minted by).
- **Table:**

  ```sql
  create table selva.service_accounts (
    user_id     uuid primary key references auth.users(id) on delete cascade,
    org_id      uuid not null references selva.orgs(id) on delete cascade,
    name        text not null,
    created_by  uuid references auth.users(id) on delete set null,
    created_at  timestamptz not null default now()
  );
  ```

- **One org, fixed at creation,** same as a token. It is an ordinary `org_members` row in that org,
  so membership checks, project membership and `read_all_org_projects` work unchanged.
- **Tokens for it** are `api_tokens` rows with `user_id = <service account>` and
  `created_by = <admin who minted>`. No token schema change.

### It cannot log in

- **No credential exists:** no password hash, no OAuth identity. On Supabase the user is created
  through the admin API with a synthetic, undeliverable email (`sa-<uuid>@service.invalid`).
- **The login paths refuse it explicitly** (password, magic link, OAuth callback, header auth),
  by checking `service_accounts` before a session is issued. Belt and braces: an operator could
  otherwise attach an identity through the Supabase dashboard.
- **Not via GoTrue's ban.** The resolver treats `user.disabled` as "refuse every key", so a ban
  would also kill the tokens. Disabling a service account _is_ meant to kill its tokens, so
  `disabled` keeps that meaning and login is blocked by the explicit check instead.

### Who manages it

- **New org permission `manage_service_accounts`,** in the admin role defaults. Creating,
  renaming, disabling, deleting a service account and minting or revoking its keys all need it.
- **Minting a key for it is capped by the minter's live rights,** the rule that already applies to
  personal keys. After minting, the key's reach is the service account's own membership and
  project grants, re-checked live on every request.
- **A service account never holds platform permissions or the org `admin` role,** and never counts
  toward the last-admin invariant. Otherwise the humans could be locked out of their own org by
  an account no one can sign in as.
- **Endpoints** are session-only and `x-internal`, like the token endpoints:
  `GET/POST /api/v1/orgs/{orgId}/service-accounts`,
  `PATCH/DELETE /api/v1/orgs/{orgId}/service-accounts/{id}`,
  `POST /api/v1/orgs/{orgId}/service-accounts/{id}/tokens`. The roster at
  `GET /orgs/{orgId}/tokens?all=true` already includes its keys.

### How RLS sees it

- **Exactly as a member.** The delegated JWT carries `sub = <service account>` and
  `selva_org = <org>`; `selva.is_instance_admin()` is false for it as for every delegated session.
  Private projects are reached only through project membership, as for a person.
- **No new policy.** `service_accounts` itself gets SELECT for members of its org and writes only
  through `manage_service_accounts`.

### Lifecycle

- **The creator leaving changes nothing.** Removing a member revokes keys where `user_id` is that
  member; the service account's keys have a different `user_id`. `created_by` goes null on erasure,
  which the audit log already tolerates.
- **Disable** sets `disabled` on the user: every key is refused at resolution, and re-enabling
  restores them (unlike member removal, which revokes, because the account itself is the
  integration).
- **Delete** revokes its keys (reason `service_account_deleted`, appended to
  `ApiTokenRevokeReason`), removes the membership, and deletes the user; the token rows stay,
  marked, for the audit trail.
- **Events:** `service_account.created`, `service_account.disabled`, `service_account.deleted`,
  ids only.

## Open questions

- Does GoTrue's admin API on the hosted tier accept the synthetic email without sending mail
  (`email_confirm: true`), or do we need a phone-less, email-less user path?
- Should a service account appear in the member list, or in its own section? It is a member for
  every rule, but people count members as seats.
- Can a host create one programmatically (a `createServiceAccount` handler a host mounts behind its
  own UI), or only through the Selva endpoints?
- Expiry: personal keys must expire within 180 days. An integration owner may want longer for a
  service account key; keeping the cap and relying on the expiry email is the default.
