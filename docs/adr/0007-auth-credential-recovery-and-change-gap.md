# ADR 0007: Credential Recovery & Self-Change Belong on `IAuthProvider`

> **Status: Accepted (2026-07-23), unimplemented.** Records that password
> recovery, self-service password change, and email change are missing from the
> auth contract and **should live behind [`IAuthProvider`](../../packages/platform/src/auth/interface.ts)**,
> not in each consuming app. Fixes the surface shape now; defers the build until a
> consuming app actually needs it (at which point a consumer is already doing it
> the workaround way; see Consequences).

## Problem

The password surface on [`IPasswordAuth`](../../packages/platform/src/auth/interface.ts)
is exactly three methods:

```ts
verifyLogin(email, password): Promise<LoginResult>;
createUserWithPassword(email, password): Promise<AuthUser>;
registerUser?(email, password): Promise<AuthUser | null>;
```

There is **no** surface anywhere on `IAuthProvider` (or any of its five
sub-interfaces) for the rest of the credential lifecycle:

1. **Password recovery**: send a reset link / initiate recovery for a
   forgotten password.
2. **Self-service password change**: a signed-in user setting a new password.
3. **Email change**: a signed-in user changing their address (with the
   provider's confirmation flow).

Account **deletion/disable** _are_ on the contract (`deleteUser`, `disableUser`),
and identity erasure has `onUserDeleted`. Recovery/change is the one lifecycle
gap. The Supabase implementation
([SupabaseAuthProvider.ts](../../packages/providers/supabase/src/auth/SupabaseAuthProvider.ts))
already holds **both** an anon and a service-role client, and its
`parseCallbackParams` already tolerates `type: 'recovery'` OTP tokens, but
nothing calls `resetPasswordForEmail`, and there is no method to set a new
password after such a token verifies, nor to update email. The send-side and the
set-new-password side are simply absent.

Because the capability isn't on the contract, a consuming app that needs
"forgot password" has only one option: **reach past the provider to the
underlying auth SDK directly** (build its own anon Supabase client, call
`resetPasswordForEmail` / `updateUser`). That is a layering violation forced by
the contract: credential lifecycle is auth-provider concern, exactly like
`verifyLogin`, and it should not leak into the driving adapter or the route
layer. It also means each consumer re-implements recovery, re-derives the
redirect/callback handling, and couples itself to Supabase specifics the
provider abstraction exists to hide.

Selva is pre-first-release: the contract can still grow required-ish methods
cheaply, and the shape is worth fixing before multiple consumers each grow their
own bypass.

## Decision

**Credential recovery and self-change are `IAuthProvider` concerns.** They will
be added to the auth contract and implemented per-provider, so the consuming app
calls `getAuthProvider().passwordAuth?.…` instead of a hand-rolled auth client.

The shape (names indicative, finalize at implementation):

- On `IPasswordAuth`:
  - `resetPassword(email: string, redirectTo: string): Promise<{ ok: true } | { ok: false; reason: 'rate_limited' | 'invalid_email' | 'signup_disabled' }>`
    initiates recovery. Deliberately **opaque about existence** (never reveals
    whether the email is registered), mirroring how `registerUser` returns
    `null` rather than leaking. Matches the existing `IEmailLinkAuth.sendMagicLink`
    result shape.
  - `updatePassword(newPassword: string): Promise<UserManagementResult>` sets a
    new password for the **currently-authenticated** caller (the provider is
    handed the caller's token/context, as elsewhere).
  - `changeEmail(newEmail: string): Promise<UserManagementResult>` begins an
    email change for the current caller (provider owns the confirmation flow).
- The **recovery-token verification** side already half-exists via
  `parseCallbackParams` / `verifyMagicLink`; formalize a `verifyRecovery` (or
  fold it into the above) so a consumer never parses provider callback params
  itself.

Result types reuse the house style: `UserManagementResult`
(`'ok' | 'not_found' | 'not_supported' | 'last_admin'`) and discriminated-union
outcomes, not booleans or throws.

**The implementation is NOT built in this ADR.** No consumer in-tree needs it
today, and speccing the exact method set is cheaper once the first real caller
exists to validate the redirect/callback ergonomics. This ADR fixes _where the
capability lives_ (behind the provider) so the first implementer doesn't put it
in the wrong layer.

## Consequences

- The layering rule is now explicit: a consuming app must **not** construct its
  own auth SDK client for recovery/change once these land: it calls the
  provider. Until they land, a consumer that needs "forgot password" will build
  the bypass; that bypass is the signal to implement this ADR, and it should be a
  near-mechanical swap (the routes/UI stay; only the innards move from a raw
  client to `passwordAuth.resetPassword(...)`).
- Adding methods to `IPasswordAuth` is a **breaking change for external
  `IAuthProvider` implementers**: it wants a Changeset entry and per-provider
  fan-out: the Supabase impl
  ([SupabaseAuthProvider.ts](../../packages/providers/supabase/src/auth/SupabaseAuthProvider.ts)),
  plus `LocalAuthProvider` and `HeaderAuthProvider`, and the conformance suite
  ([authProviderSuite.ts](../../packages/platform/src/testing/suites/authProviderSuite.ts)).
  Making them optional (`?`) on `IPasswordAuth` avoids the break for providers
  that genuinely can't offer recovery (header/proxy auth), and matches how
  `registerUser?` is already optional.
- The Supabase impl needs no new configuration: it already has the anon and
  service-role clients required for `resetPasswordForEmail` and
  `admin.updateUserById`.
- The conformance suite gains recovery/change coverage, so every provider that
  advertises the capability is held to the same contract.

## Alternatives considered

- **Leave it out of the contract; let each consumer talk to the auth SDK
  directly.** Rejected: credential lifecycle is auth-provider concern, and every
  consumer would re-implement recovery + couple to Supabase specifics the
  provider exists to hide. Fine as a one-off stopgap in a single consumer, not as
  the design.
- **Build the full implementation now.** Rejected as premature: no in-tree
  consumer needs it, and the method set (especially redirect/callback handling)
  is best finalized against a first real caller. This ADR captures the
  irreversible part (the layer) without the speculative build.
- **Model recovery on the existing `IEmailLinkAuth` (magic-link) surface only.**
  Rejected as insufficient: magic links verify an identity but there is still no
  method to _set a new password_ afterward, and no email-change path. Recovery
  reuses the `sendMagicLink` result _shape_, but needs its own methods.
