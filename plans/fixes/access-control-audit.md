# Access Control Audit — Open Items

**Run:** 2026-08-17 · four independent read-only agents against current `main`, each playing mutation scenarios through real code and scoring them against [`packages/selva/specs/Permissions.md`](../../packages/selva/specs/Permissions.md). Scope: org-scope membership mutation, platform-scope (instance admin) mutation, project-scope membership/visibility/reclaim, and session/auth lifecycle.

**Trigger:** "user removed from Test Project can still see it" — which turned out to be correct-by-spec (`public` visibility grants access independently of membership, [rules.ts:87](../../packages/platform/src/access/rules.ts#L87)). The audit that question prompted found five ways to take over an org or brick an instance.

**How to use this doc:** work top to bottom. Status: `☐ open` / `▶ in progress` / `✅ done` / `🧊 deliberately deferred`.

**Verification pass — 2026-08-17.** Every finding below was independently re-checked against the code by four fresh agents plus direct reading. **All 20 original findings confirmed; no false claims.** The "Verified correct" section also held up — no claim there was wrong. Corrections, upgrades and additions are folded in below and marked **`[verified]`**, **`[upgraded]`** or **`[new]`**. Two path errors fixed: `ProjectSettingsDialog.svelte` lives at `routes/projects/_components/`, not `$lib/components/` (findings 3 and 13).

**Maintainability pass — 2026-08-17.** A second review asked whether the layer is simple enough to _stay_ correct once these are fixed. **It is — the design is sound and should not be restructured.** See [Maintainability review](#maintainability-review) for what to protect, the seven dead symbols, and four small items (26–29). Nothing there argues for an architectural change.

**Contents:** finding 0 (P0, unauthenticated) · 1–5 (P0) · 6–12 (P1) · 13–20 (P2) · 21–25 (found while verifying) · 26–29 (maintainability).

---

## ✅ Pass 1 shipped — 2026-08-17

**Every P0 is closed (0–5), plus the cleanup that touched the same files (22, 27, part of 26).** `pnpm type-check`, `pnpm lint` (0 errors) and `pnpm check` (0 svelte-check errors) all pass; `@selvajs/selva` is 486/486 green with 14 new tests across 5 files. The failing `@selvajs/supabase-provider` conformance tests were **pre-existing on clean `main`** (verified by stashing). ~~They need a live Supabase stack.~~ **Corrected in Pass 2:** they were an unapplied migration plus a real expiry-filter bug in `SupabaseShareLinkStore`, and are now fixed.

Each new test was checked to actually fail without its fix, not merely to pass with it.

| Finding   | Change                                                                                                                                                                            | Test                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 0         | `hasInstanceAdmin` re-check at the top of the `/setup` action                                                                                                                     | `setup/__tests__/setup-reentry.test.ts`                     |
| 1         | owner-only `orgRole` gate in the invite mint route + `invitableRoles` in the team UI                                                                                              | `invites/__tests__/owner-invite-escalation.test.ts`         |
| 2         | `checkOwnerRemoval` on owner-reducing PATCH, with the same `?confirm=true` step as DELETE                                                                                         | `members/[userId]/__tests__/owner-demotion.test.ts`         |
| 3         | `instance_admin` required for `visibility: 'platform'` on POST **and** PATCH                                                                                                      | `projects/__tests__/platform-visibility-gate.test.ts`       |
| 4         | disable revokes `instance_admin` before setting the flag, so a disabled admin stops counting                                                                                      | `admin/users/[id]/__tests__/admin-removal-boundary.test.ts` |
| 5         | new `requireCanRemoveInstanceAdmin` shared by DELETE + disable; local `assertCanRead` now admits `manage_instance_users` so the denial is a deliberate 403, not an accidental 500 | same file                                                   |
| 22        | deleted 7 dead symbols; collapsed `requireCanManageMembers` into `requireCanManage(…, 'members')`                                                                                 | —                                                           |
| 26 (part) | `ProjectVisibility` imported instead of the hand-written union                                                                                                                    | —                                                           |
| 27        | `SettingsMenu.svelte` derives from `ALL_*_PERMISSIONS`                                                                                                                            | —                                                           |

**Two decisions recorded:** finding 14 is 🧊 deferred deliberately (spec edit only — see its entry); finding 4 was fixed by revoking on disable rather than teaching the store the `disabled` flag, keeping the store boundary intact.

**Note for whoever picks up finding 18:** it is now _partly_ done. Local `assertCanRead` and `assertCanReadBatch` agree, and the delete/disable routes gate deliberately, so aligning Supabase up no longer re-arms finding 5. The blanket `catch` in `admin/users/+page.server.ts:88-90` is still unfixed.

---

## ✅ Pass 2 shipped — 2026-08-17

**Findings 21, 23, 24 and 25 are closed.** `pnpm type-check` (22/22), `pnpm lint` (0 errors) and the full `pnpm test` all pass — **including `@selvajs/supabase-provider` at 239/239**, which had 9 failures before this pass (see below). `@selvajs/selva` is 499/499 with 13 new tests across 4 files.

| Finding | Change                                                                                                                                                   | Test                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 21      | route resolves through `getVisibleDefinition` like its siblings, so an invisible guid 404s instead of 403                                                | `[guid]/versions/__tests__/version-list-visibility.test.ts`   |
| 23      | new `scopeToOrgId` option on `getConfig`, applied in both stores via the pure `scopeConfigToOrg`; three org-facing callers pass it                       | `lib/server/compute/__tests__/config-org-scoping.test.ts`     |
| 24      | upload fallback resolves from `resolveAccessibleProjects` (the caller's `canView` set) instead of an unfiltered `listProjects`                           | `definitions/__tests__/upload-project-fallback.test.ts`       |
| 25      | share ctx gains `shareLinkId` + a `share:{id}` sentinel actor; `assertNotShareContext` added to the six store guards that start `if (ctx.system) return` | `lib/server/shareLinks/__tests__/share-ctx-authority.test.ts` |

**On finding 25's shape.** `system: true` was doing two unrelated jobs on the share path: pick the service-role client (correct — no user JWT exists to scope RLS) and "fully authorized" (wrong). Rather than strip `system`, which would have broken adapter dispatch, `shareLinkId` marks _why_ it is set, and the guards refuse on that. `forRequest` deliberately still keys on `system` alone.

**Verified by mutation, not by passing.** Removing the guards from the loaded `LocalPlatformPermissionStore` build turned 2 of the 4 share-ctx tests red; reverting the finding-21 route to its unfiltered read turned the cross-tenant test red. Both restored after. Worth recording: the selva tests resolve `@selvajs/local-provider` through built `dist`, **not** source — a source-only edit proves nothing there.

### The 9 Supabase failures were two real bugs, not environment

Pass 1 recorded these as pre-existing and stack-dependent. That was true of the symptom but wrong about the cause — both were fixable:

- **7 invite/org failures** — migration `20260817120000_invite_platform_permissions.sql` existed in the repo but had never been applied to the local database (`supabase migration list` showed it local-only). Applying it fixed all seven. Nothing to change in code.
- **2 share-link failures** — a genuine provider divergence. `SupabaseShareLinkStore.listByDefinition` and `getByTokenHash` filtered `revoked_at` but **not** `expires_at`, so an expired link stayed listed and resolvable there while the local store reported it dead. Both now filter expiry in SQL.

The second one is worth dwelling on: the local store's comment said it filtered expiry _"to match what Supabase filters in SQL"_, and the conformance suite's comment said the same. **Supabase never filtered it.** Both comments described an invariant that only one side upheld, which is precisely how a shared conformance suite is supposed to fail — and it did, as soon as the stack was actually running. Comments in all three places now state the contract rather than attributing it to one provider.

---

## ✅ Pass 3 shipped — 2026-08-17

**Findings 6 and 7 are closed.** `pnpm type-check` (22/22), `pnpm lint` (0 errors), `pnpm check` (0 svelte-check errors) and the full `pnpm test` all pass. `@selvajs/selva` is **507/507**, with 8 new tests across 2 files.

| Finding | Change                                                                                                                                      | Test                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 6       | four platform-scope event types added to `DomainEvent`; emitted from the `permissions.server.ts` seam plus the create/delete/disable routes | `api/admin/users/__tests__/platform-audit-trail.test.ts` |
| 7       | logout revokes the session provider-side before clearing cookies, via a new `getSessionToken` accessor                                      | `routes/logout/__tests__/logout-revokes-session.test.ts` |

**Finding 6 landed where the plan predicted.** `permissions.server.ts` was 18 lines whose own doc promised writes funnel through it _"so any future change (caching, invalidation, audit hooks) is one-file"_ — that held. All six silent grant paths (PATCH, create-user, disable's pre-revoke, `/setup`, `accept-invite`, and the delete path's cascade) emit from that one edit, because every one of them already routed through the seam. `SYSTEM_CONTEXT` callers emit with `actorId: 'system'`, which is the right attribution for a bootstrap grant.

Emission is gated on `result === 'ok'`: a `last_admin` refusal or a missing user changed nothing, so recording a change would be a lie. That gate is one of the mutation-tested behaviours.

Two ordering decisions worth keeping:

- `user.deleted` emits **after** `onUserDeleted`, not before. The erasure pass deletes audit rows the deleted user authored; emitting first would delete the row recording the deletion. The actor is the admin, so the row survives.
- The audit page's `KNOWN_EVENT_TYPES` array — a hand-maintained third copy of the union — became a `Record<DomainEventType, true>`. A new variant is now a type error there instead of a filter option that silently never appears. The `TYPE_LABELS` map in the `.svelte` file was already compiler-complete; it lives inside the component's `<script>` and is not importable, so the two stay separate by necessity rather than by choice.

User targets now resolve to a display name by riding the profile/auth batch the actor lookup already performs — one merged set, not a third round-trip. A deleted user resolves to neither and renders as a raw id, which is correct: the row outlives the person it names.

### Finding 7 is half a fix, and the other half is not implementable as written

**The logout half is done and was exactly as described.** Deleting the cookie never touched the token; on Supabase the access token stayed valid at GoTrue and the refresh token lived 30 days. `revokeSession` with `signOut(token, 'global')` kills every session for that user, so revoking with the access token also kills the refresh token — no second call needed.

**The disable half cannot be wired the way the finding proposes.** `revokeSession(token)` takes the _target's session token_, and an admin disabling someone else has their user id and nothing else. There is no by-user-id revocation to call:

- `ISessionRefresh` exposes only token-based revocation.
- GoTrue's admin API has no sign-out-by-user-id — `supabase.auth.admin.signOut` requires _"a valid, logged-in JWT"_.
- No provider signs sessions out inside `disableUser`; all three only set a disabled flag.

I prototyped an optional `revokeAllForUser(userId)` on `ISessionRefresh` and reverted it. The only honest Supabase implementation is a SECURITY DEFINER RPC deleting `auth.refresh_tokens` rows — a migration plus new privileged surface. **That is not proportionate to what it buys**, because the exposure is already bounded: `disableUser` sets `user_metadata.disabled`, and `refreshSession` rejects disabled users, so a disabled user cannot mint anything new. What survives is one already-issued access token until `revalidateMs` (default 60s), not the 30-day refresh token the finding's severity implies.

So the disable route's docstring — which claimed _"disabling a user invalidates sessions"_ and pointed at `revokeSession` as the remedy — was the actual defect. It now states the real bound per provider and says why this route cannot close it. **Finding 7's spec ask ("either fix the code or state the bounded window") is satisfied by fixing logout and stating the window for disable.**

If instant cutoff on disable is wanted later, it is its own scoped piece of work: `revokeAllForUser` on the interface + an RPC migration. Not folded in here.

**Verified by mutation.** Disabling the `result === 'ok'` gate and the logout revoke call turned 3 tests red (both permission-event assertions and the logout revoke); both restored after.

**Fixture change:** `freshProviders` now installs a `RecordingEventSink` instead of `NoopEventSink` and exposes `tp.events`, so any test can assert on an audit trail. `installSessionRefreshShim` follows the existing `installOAuthShim` pattern — the local provider mints stateless HMAC tokens and legitimately exposes no `sessionRefresh`, so a typed shim is the only way to test the path Supabase takes.

**Next up:** 8/9 (store-interface changes across both providers — 8 needs a by-email query on `IInviteStore` that does not exist yet; 9 needs the `/team/shares` roster built or a cascade-revoke). Also still open: finding 18's blanket `catch` in `admin/users/+page.server.ts:88-90`, and findings 11/26/28/29.

---

## ✅ Pass 4 shipped — 2026-08-17

**Findings 8 and 9 are closed.** Both were store-interface changes across two providers, as predicted. Verified against the live Supabase stack, not just local.

| Finding | Change                                                                                                                                               | Test                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 8       | `revokePendingByEmail` on `IInviteStore`, both providers; called from the org-member DELETE route                                                    | `members/[userId]/__tests__/removal-revokes-invites.test.ts` + 5 conformance cases |
| 9       | `listByOrg` on `IShareLinkStore` (new `OrgShareLink` row), both providers, new RLS policy + index; `/team/shares` stub replaced with the real roster | `team/shares/__tests__/share-roster.test.ts` + 5 conformance cases                 |

### Finding 8 — one call, not list-then-revoke-each

`revokePendingByEmail(ctx, orgId, email)` returns the ids it revoked. A query method plus a loop in the route would have raced a concurrent accept between the two round-trips, and would have needed the route to emit N events itself. Matching by **email, not user id** is deliberate: an invite names an address, and the account it will create may not exist yet.

Emails are stored lowercase at mint; both stores normalize the needle too, so an offboarding call with the address as an admin typed it still matches. There is a conformance case for exactly that.

The route logs rather than swallows a failure here — a silent `catch` on this path leaves a live re-entry route, which is the pattern finding 18 flags. The removal itself has already committed, so failing the request would report an offboarding that _did_ happen as one that didn't.

### Finding 9 — the roster, and why not the cascade

The cascade was the smaller option and it is the wrong one. Recorded on the finding itself; the short version is that a share link is an org asset that happens to have a minter, so revoking on departure punishes whoever holds the URL — usually a client — rather than the leaver. It also only fires on org-member removal, so disabled and deleted users' links survive it anyway.

**What the roster required.** `listByOrg` has no org column to filter on: the org is two hops up, `link → definition → project`. Supabase does it as one `!inner` join (a filtering join, so soft-deleted parents drop out for free); the local store does the same walk as lookups, mirroring how `getByTokenHash` already handles the soft-delete cascade. The new RLS policy is deliberately **SELECT-only and separate** from the existing editor policy — revoking still requires edit rights on the parent definition, so seeing the roster never implies authority over it. The page reuses the existing per-definition DELETE endpoint for exactly that reason.

**Gated on `manage_org_members`, not `manage_projects`.** The latter can be handed to a plain member (§11), who has no business enumerating every credential in the tenant. The RLS policy and the load function gate on the same permission, so the two layers agree rather than one being a superset.

**`OrgShareLink` omits `tokenHash` from the type**, rather than merely not reading it. This is the only share-link shape built for a page, and it spans every definition in the org — so a careless serialization would ship every credential digest in the tenant at once. Both the conformance suite and the route test assert its absence, and both go red when the omission is removed.

**Two wiring traps worth knowing.** The local store needs `setProjectProvider` from the composition root, and unwired it returns **empty** rather than unfiltered — a share-link list that silently spans tenants is worse than no list. The local conformance harness now builds a real `LocalDataProvider` instead of constructing the store directly, so a missing setter fails the suite instead of passing against nothing. Separately, `providers.server` has a mock surface in `__tests__/setup.ts` that must gain each new accessor; `mock-surface.test.ts` guards this and caught it.

**Verified by mutation.** Killing the `manage_org_members` gate turned the member-refusal test red; removing the `tokenHash` omission turned both the conformance case and the route test red; stubbing out the invite-revocation lookup turned 3 of the 4 finding-8 route tests red (the fourth is the no-invite control, correctly still green). All restored.

**Conformance counts:** invites 7 → 11 per provider, share links 14 → 19 per provider, both green on local **and** against the live Supabase stack.

### Written into the PAT plan

`IApiTokenStore` in [token-plan.md](../features/token-plan.md) had the same gap by design — `listByUser` only, and a `deleteByUser` cascade covering deleted users but not removed or disabled ones. Two notes added there: `listByOrg` is required and should match `OrgShareLink`'s shape including the omitted hash, and offboarding is roster-driven rather than cascading, for the same reason as share links. `/team/tokens` is then largely `/team/shares` with the first hop swapped, and this pass's RLS policy is the template.

---

## ✅ Pass 5 shipped — 2026-08-17

**Findings 11 and 18 closed.** Both were "the two providers mean different things by the same call", which is why they went together.

### Finding 11 — filter at the route, not in the store

The plan said to fix the `_ctx` divergence by making `LocalProjectStore.listProjects` honor its context. **That was the wrong call and was not done.** `listProjects` is a raw store read, used deliberately with `SYSTEM_CONTEXT` by `visibility.server.ts`, `/admin/projects` and reclaim — the very callers that must see past a caller's visibility. Teaching it to filter would have made a low-level read mean two things depending on who called it, and it still would not have matched Supabase's RLS predicate exactly.

The filter belongs where the audience is known. `/team/projects` now calls `resolveAccessibleProjects(ctx)` — the same `canView` pass the library and `/projects` already use — and narrows to the acting org. That is provider-agnostic by construction: local and Supabase now agree because neither is deciding.

**Why this page and not reclaim.** `/team/projects` gates on `manage_projects`, which §11 says an admin may hand to a plain member; the gate means "may administer projects", never "may see every project". `/team/reclaim` gates on `manage_org_members` (owner/admin only) and exists **specifically** to reach projects leadership cannot currently view — an orphaned private project whose owner has left. Filtering it would empty it of the only rows it exists to offer. Its `SYSTEM_CONTEXT` scan is now documented as deliberate rather than left looking like an oversight.

The missing audit event on that read was considered and **not** added: a new `DomainEvent` variant plus every sink is disproportionate for a page load, and the escalation itself is already audited — `addProjectMember` emits `project_member.added` naming the actor, so taking co-ownership leaves a trace.

Member counts still run as `SYSTEM_CONTEXT`, now with a reason on the line: visibility was already decided before the project became nameable, so counting is a leadership read rather than a second access decision.

### Finding 18 — both halves

**The guard.** `SupabasePlatformPermissionStore` gained `assertCanReadBatch` and admits `manage_instance_users` on `getFor` too, matching local and §8. Read access is not authority — `set` stays `instance_admin`-only through `assertAdmin`, and delete/disable gate separately (Pass 1). Aligning up no longer re-arms finding 5.

Three cases went into `platformPermissionStoreSuite` rather than either provider's own tests, so the two cannot drift here again: the role can batch-read, can read singly, and **cannot** `set`. That last one is what keeps "can see" and "can grant" apart in the suite itself.

**The catch.** `admin/users/+page.server.ts` now distinguishes three outcomes that were previously one. `users: null` still means "this provider exposes no user store" and renders wiring advice. A `ProviderError` re-throws as its own status — `statusCode`, not `status`, which is the field the old check got wrong. Anything else logs and degrades, so an outage is no longer indistinguishable from an unconfigured `DATA_PATH`. The log line carries `actorId` and a message string, never the error object (CLAUDE.md).

### Verified by mutation

Reverting `/team/projects` to a raw `listProjects` turned the private-project test red. Reverting the Supabase batch guard to `assertAdmin` turned the conformance case red against the live stack. Removing the `ProviderError` re-throw turned the denial test red. All restored; 9 new selva tests and 3 new conformance cases per provider, green on local and against live Supabase.

**Next up:** 26/28/29 — closed in Pass 6 below, which also found that the maintainability tranche was not the pure subtraction it looked like.

---

## ✅ Pass 6 shipped — 2026-08-17

**Findings 26, 28 and 29 are closed — the maintainability tranche.** Pure subtraction plus two extractions. `pnpm type-check` (22/22), `pnpm lint` (0 errors), `@selvajs/selva` **539/539** with 14 new tests across 2 files.

| Finding | Change                                                                                                    | Test                                                   |
| ------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 26      | `DefinitionCard.svelte` imports `ProjectVisibility` instead of re-declaring the union                     | —                                                      |
| 28      | `createProjectWithUniqueSlug` extracted; both create routes call it; v1 POST calls `validateProjectFlags` | `projects/__tests__/createProject.server.test.ts` (8)  |
| 29      | `assertCanGrantPlatformPermissions` replaces 3 copies; `permissions-compat` → `permissions-scope`         | `__tests__/platform-permission-delegation.test.ts` (6) |

### The tranche found a live test gap, not just duplication

Consolidating three copies of the delegation rule into one function is only safe if something proves the surviving copy works. It didn't: **disabling `assertCanGrantPlatformPermissions` entirely left the suite at 525/525 green.** Three separate escalation paths were guarded by code no test reached.

The cause is worth recording because it generalizes. `invites/__tests__/platform-permissions.test.ts` has a case titled _"refuses platform permissions from an org admin who is not an instance admin"_, commented _"bob can invite members"_ — **bob cannot.** He is a plain org `member` in `seedAcme`, so `requireManageOrgMembers` rejects him at the route's first gate and the delegation guard never runs. The test asserted a 403 and got one, from the wrong line, and had been passing vacuously since it was written.

**A denial test must act as someone who clears every gate except the one under test.** The new file therefore acts as an org **owner** for the invite path and as a `manage_instance_users` holder for both admin paths — actors who pass their route's own gate and must still be refused. Disabling the guard now turns 4 of the 6 red; the two positive controls (an ordinary org invite, an instance admin granting scope) stay green, which is what proves the guard didn't just become a blanket deny. The old test was kept, retitled to say what it actually asserts, and points at the new file.

Finding 28's extraction turned up the same shape: the slug-retry loop existed in two copies and **neither was tested**, though it gates on a regex matched against a Postgres constraint name. Rename the constraint and the loop silently stops retrying, turning a routine collision into a 500. Eight cases cover it now.

**One shape change from the plan.** Finding 29 proposed `assertCanGrantPlatformPermissions(ctx, requested)`. PATCH needs more: it gates on _change_, not _grant_, because revoking `instance_admin` is a platform-scope write too. With the proposed signature a `manage_instance_users` holder could PATCH `permissions: []` onto every admin above them and pass. The helper takes an optional `current` instead, and the fifth test pins that case.

**Next up:** 12 — closed in Pass 7 below.

---

## ✅ Pass 7 shipped — 2026-08-17

**Finding 12 is closed.** One migration, one route change, one UI gate. `pnpm type-check` (22/22), `pnpm lint` (0 errors), `pnpm check` (0 errors), `@selvajs/selva` **545/545** (+6), and `@selvajs/providers-supabase` **181/181 against a live Postgres** — the whole point, since RLS cannot be tested any other way.

| Divergence                                              | Outcome                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| #3 Project mutation keys on `owner_id`, not member role | **Fixed** — `selva.is_project_owner()` reads `project_members`; 5 policies now use it            |
| #4 Public project exposes its full member roster        | **Fixed** — narrower SELECT policy, plus the route decision that makes both providers agree      |
| #1 `visible_project` has no `platform` branch           | **Deliberately open** — the feature does not exist on this provider; documented in the migration |
| #2 `public` ignores `ALLOW_CROSS_ORG_PUBLIC`            | **Deliberately open** — Postgres cannot read a deploy-time env flag; documented in the migration |

### The reclaim break, reproduced and fixed

`canManage` and `canEditProjectSettings` are both `member?.role === 'owner'`. The policies read `projects.owner_id`. Those agree until a Reclaim, which adds an owner-role member row and **deliberately leaves `owner_id` alone** — after which the app layer authorizes an edit that RLS rejects.

The live-stack test reproduces it exactly: with the old predicate restored, renaming a reclaimed project comes back as `ProviderError: Project '…' not found`, because `updateProject` maps an RLS-filtered update to a 404. Not an error a user could ever diagnose. With the fix, it passes; the negative control — an editor who must still be refused — stays red-on-attempt, which is what proves the fix narrowed rather than widened.

**Postgres charges for the UPSERT.** `addProjectMember` upserts so a soft-deleted row reactivates in place, and Postgres checks an upsert against the INSERT policy _and_ the UPDATE policy. The first attempt gave the owner-seeding rule an INSERT arm only, and it rejected the very first `createProject` — the ON CONFLICT arm had no UPDATE policy to fall back on. Both arms, always; the migration says so where the next person will hit it.

### Two divergences left open, on purpose

Closing a "drift" by inventing the thing it drifted from is not a fix. `platform` visibility is not a hole on Supabase — the `visibility` CHECK constraint does not admit the value and `IPlatformProjectGrantStore` throws 501, so there is no grant table for a policy to read and the constraint already fails closed. `ALLOW_CROSS_ORG_PUBLIC` is worse to "fix": mirroring a deploy-time env flag into the database gives the same question two answers that can disagree, which is a worse failure than RLS being the more permissive of two layers. Both reasons now live in the migration, so the next audit does not re-raise them as oversights.

### The roster fix had to go to the route, not only to RLS

Tightening the SELECT policy alone would have made Supabase quietly stricter than local — the same class of drift this finding is about, pointing the other way. Pass 5's precedent applies: decide where the audience is known. `/projects` now loads the roster only for projects the caller `canManage`, so both providers agree because neither store is deciding, and the policy is the backstop under it.

That pulled a UI bug up with it. The settings button was gated on `data.canManageProjects` — the **org-wide** permission §11 says an admin may hand to a plain member — so it was offered on every visible row while the `PATCH` behind it is owner-only. A dead-end affordance, the same shape finding 11 found on the Delete button. The loader already computed the per-project decision and threw it away; it now returns `canManage` per row and the button follows it. The `ProjectWithMembers.canEdit` doc claimed it covered "change settings", which is what mis-gated this in the first place — `canEdit` is owner _or editor_, settings are owner-only. Corrected.

### Verified by mutation, both halves

Reverting `is_project_owner` to the `owner_id` predicate turns the reclaim test red against the live stack with the original 404. Reverting the route to an unconditional `listProjectMembers` turns 3 of the 6 selva tests red while both positive controls stay green. Both restored, both suites re-run green.

One trap worth recording for anyone writing the next RLS test: `test-helpers.ts` has two seeders, and the default `seedUser` **promotes to `instance_admin`**. Every policy in this migration short-circuits on `is_instance_admin()`, so a test written with it passes no matter what the rest of the policy says — vacuous in exactly the way Pass 6's invite test was. `project-rls.test.ts` uses `seedPlainUser` throughout and says why at the top.

**Next up:** 10 (header-auth trust boundary, incl. `rebindUpn`). 13/15/16/17/19/20 remain open. Spec edits still outstanding: §5 must record that `private → org` is intentionally ungated (finding 14), §10 needs the per-provider session-invalidation bound (finding 7) and a line saying the share-link roster is the compensating control its "unaffected" stance assumes (finding 9).

---

## The shape of the problem

One sentence explains most of what follows: **`rules.ts` is well built and well tested as pure functions; the specific route handlers that call it were never exercised adversarially.** Findings 1, 2, 4 and 5 are all route-layer wiring bugs sitting directly behind correct, tested rules.

**`[verified]` — the original "route handlers are almost entirely unexercised" was too broad and is corrected here.** There are 38 test files, a working harness (`freshProviders` / `actAs` / `call`), and genuinely adversarial route tests including `patch-member-escalation.test.ts`. The gap is narrower and more actionable: **every existing invite test uses `orgRole: 'member'` — nobody ever tried `'owner'`.** Fixes are cheap to test because the harness already exists.

The second pattern: **parallel write paths that skip the guards their sibling enforces.** The invite route writes `org_members` without the owner-only gate the PATCH route has. The members PATCH route changes roles without the sole-owner check the DELETE route has. Both are the same mistake in different scopes.

A third pattern surfaced during verification: **`_ctx` in the local provider.** `LocalProjectStore.listProjects`, `LocalDefinitionStore.get` and `LocalComputeServerStore.getConfig` all ignore their `RequestContext` while the Supabase equivalents filter through RLS. That single divergence is behind finding 11 and two of the new findings (21, 23). Fixing it once in the local provider is less code than patching every caller — and it makes the two providers mean the same thing.

### On complexity — read before fixing

The system is **not** too complex, and the fixes must not make it so. `rules.ts` is 270 lines of pure functions; `access.server.ts` is a clean guard layer with a documented `managementBypassOrRun` (management scope, admin bypasses) vs `contentCheck` (content scope, no bypass) split. That design is sound and worth preserving.

**These bugs are missing copies of guards that already exist — not missing abstractions.** Every P0 fix is pasting a pattern from a sibling:

| Fix                         | Copy from                                                     |
| --------------------------- | ------------------------------------------------------------- |
| 0. `/setup` re-check        | the `hasInstanceAdmin` call already in that file's own `load` |
| 1. owner-gate on invite     | the org PATCH gate at `members/[userId]/+server.ts:74`        |
| 2. sole-owner on PATCH      | `checkOwnerRemoval`, already imported in the same file        |
| 3. platform-visibility gate | one `requireInstanceAdmin` on two routes                      |
| 21. versions oracle         | `getVisibleDefinition`, already used by both sibling routes   |

Two places to resist the temptation to add machinery:

- **The spec edits.** The list at the bottom wants changes across eight sections of a 772-line document. The root cause is simpler than eight amendments: two write paths into the same table disagree. Make the invite mint route and the members PATCH route share one function, and most of the spec drift stops being expressible.
- **New rule functions.** Finding 3 asks for a `canSetPlatformVisibility` rule. One `requireInstanceAdmin` call on two routes is the smaller change; add the rule only if a third caller appears.

### Priority model

Ranked by **exploitability × blast radius**, with irreversibility as a tiebreaker. P0 = a non-owner can take over an org or brick the instance today. P1 = real damage, needs a precondition or a config. P2 = correctness/hygiene with no direct exploit.

### Fix order (dependencies are not linear — don't literally work top to bottom)

1. **0** — one line, unauthenticated, no dependencies. Do it first.
2. **1, 2, 3** — independent of each other; each copies an existing sibling guard. Add the missing tests alongside. Take the one-line `ProjectVisibility` import from 26 while in the projects PATCH route.
3. **5 before 18.** Aligning Supabase's batch-read up to local's would arm finding 5's exploit. Gate DELETE/disable first, then fix the read divergence and the blanket catch together. Fold in the `requireNotLastInstanceAdmin` helper from 29 — the same two handlers.
4. **4** — decide _where_ `disabled` lives (revoke on disable, or teach the store the flag) before touching either side; the two providers currently disagree on what "an admin" is.
5. **21, 22, 23, 27** — small, self-contained; 22 and 27 are pure subtraction. Good filler between the larger items.
6. **8, 9** — store-interface changes across two providers. Schedule as real work, not cleanup.
7. **The `_ctx` divergence** (11, 21, 24) — one fix in the local provider addresses all three. Worth doing as a single deliberate change rather than three route patches.
8. **Maintainability only, after the security work: 28, then 29's `apiRoute` convergence.** Neither is urgent, and both are pure subtraction — do them when the findings above are closed, not before.

---

## P0 — Privilege escalation and lockout

### ✅ 0. `/setup` mints an unauthenticated instance admin on an already-configured instance

**[`setup/+page.server.ts:45-98`](../../packages/selva/src/routes/setup/+page.server.ts#L45-L98)** · **CRITICAL** · **`[new]` `[upgraded]` — was buried in item 20's bullet list as a P2**

The `load` function guards correctly ([:28-32](../../packages/selva/src/routes/setup/+page.server.ts#L28-L32)): `hasInstanceAdmin` → redirect to `/login`. **The action never re-checks.** It goes straight to validation → `createUserWithPassword` → `ensureUser` → `setUserPlatformPermissions(SYSTEM_CONTEXT, user.id, [...ALL_PLATFORM_PERMISSIONS])` → `setSessionCookie` → redirect to `/admin`.

`hasInstanceAdmin` is called in exactly two places in this file: the `load` guard, and a _comment_ at :82 explaining why the grant matters. Never in the action body.

`/setup` is in `PUBLIC_PAGE_ROUTES` ([`hooks.server.ts:129-134`](../../packages/selva/src/hooks.server.ts#L129-L134)), so no session is required. The action uses `SYSTEM_CONTEXT`, so the permission store's `assertAdmin` is bypassed by design. A direct POST with an unregistered email on a fully-configured production instance creates a full platform admin and logs the caller straight in.

**What bounds it:** SvelteKit's default CSRF checks `Origin` on form-encoded POSTs, so a _cross-site_ attack is blocked — but a direct request (curl, or any same-origin XSS) is not. The duplicate-email rejection only helps for addresses that already exist. Neither is a control.

**Why this is first:** it is the only unauthenticated privilege escalation in the document, and the fix is one line — the same `hasInstanceAdmin` check the `load` already performs, at the top of the action.

**Spec:** §2 — first-run bootstrap is a one-time transition. Nothing says the action may re-run it.

---

### ✅ 1. Org admin can mint an `owner` invite and evict the founder

**[`api/v1/orgs/[orgId]/invites/+server.ts:37-84`](../../packages/selva/src/routes/api/v1/orgs/[orgId]/invites/+server.ts#L37-L84)** · **CRITICAL**

The invite route is an unguarded second door into `org_members`. It checks `manage_org_members` and blocks `platformPermissions` (line 50) — but `orgRole` accepts `'owner'` with no owner-only gate, while its sibling [`members/[userId]/+server.ts:74`](../../packages/selva/src/routes/api/v1/orgs/[orgId]/members/[userId]/+server.ts#L74) correctly enforces exactly that for direct role changes.

Full chain, reachable by an org **admin**:

1. Mint an invite with `orgRole: 'owner'` to an address they control. Not an API-only attack — [`team/members/+page.svelte:201`](../../packages/selva/src/routes/team/members/+page.svelte#L201) renders all three roles in the dropdown for any `manage_org_members` holder.
2. Accept it. [`accept-invite/+page.server.ts:140-142`](../../packages/selva/src/routes/accept-invite/+page.server.ts#L140-L142) trusts the mint-time check and explicitly does not re-verify the minter's authority.
3. Now an owner, `hasAnotherOwner` passes — `DELETE` the real owner. Sole-owner protection doesn't fire, because they just manufactured the second owner.

Founder permanently evicted, by exactly the coup §3 says is impossible: _"there is always at least one, they survive any admin coup."_

**Fix:** reject `orgRole !== 'member'` in the mint route unless the actor's `getOrgMember(...).role === 'owner'`, mirroring `members/[userId]/+server.ts:74`. Gate the dropdown options on `isOwner`.

**`[verified]`** — chain confirmed end to end. `CreateInviteBodySchema` takes `orgRole: OrgRoleSchema.default('member')` with no role ceiling; the mint route's only gate is the `platformPermissions` block at :50. [`accept-invite/+page.server.ts:165-169`](../../packages/selva/src/routes/accept-invite/+page.server.ts#L165-L169) then writes `role: invite.orgRole` verbatim through `SYSTEM_CONTEXT`. The dropdown at `team/members/+page.svelte` iterates all of `ORG_ROLES` with no `isOwner` condition. **Test blind spot:** `invites/__tests__/platform-permissions.test.ts` covers the platform-scope escalation thoroughly — and every one of its cases passes `orgRole: 'member'`. The org-scope door was never knocked on.

**Also `[new]`:** [`accept-invite/+page.server.ts:148`](../../packages/selva/src/routes/accept-invite/+page.server.ts#L148) grants `invite.platformPermissions` through the same unaudited `setUserPlatformPermissions` — a sixth silent platform-permission write path, which finding 6 omits.

**Spec:** §3 is unambiguous that role changes are owner-only, but §8 lists `/invites` as merely `manage_org_members` and never says `orgRole` needs a gate — **the spec is partly complicit and needs the same sentence added.**

---

### ✅ 2. Sole project owner can self-demote to `viewer`, orphaning the project

**[`api/v1/projects/[id]/members/[userId]/+server.ts:9-19`](../../packages/selva/src/routes/api/v1/projects/[id]/members/[userId]/+server.ts#L9-L19)** · **CRITICAL**

`checkOwnerRemoval` is imported at line 5 and used **only** in DELETE (line 37). PATCH is four lines: `requireCanManageMembers` → `parseBody` → `updateProjectMemberRole`. Demotion is a role change, not a removal, so it bypasses the guard entirely.

`PATCH {role: 'viewer'}` on your own userId as sole owner → `canManage`, `canEditProjectSettings` and `canEdit` all go false. Project self-locked; recovery needs reclaim or `instance_admin`. Combined with finding 3, not even reclaim works.

Same route also bypasses the owner-on-owner `?confirm=true` step from §5 — PATCH a co-owner to `viewer` instead of DELETEing them.

**Fix:** consult `checkOwnerRemoval` on any transition that reduces the owner count, not just removal.

**`[verified]`** — exact. PATCH is literally `requireCanManageMembers` → `parseBody` → `updateProjectMemberRole` → `noContent()`. DELETE, twenty lines below in the same file, does the full `checkOwnerRemoval` dance including the `?confirm=true` branch. The guard is imported at line 5 and reachable from both.

**Spec:** §5:391-400 names only DELETE, so this is a **spec gap too** — the invariant is stated only in terms of removal.

---

### ✅ 3. Any project owner can escalate a project to `visibility: 'platform'`

**[`api/v1/projects/[id]/+server.ts:86-116`](../../packages/selva/src/routes/api/v1/projects/[id]/+server.ts#L86-L116)** (PATCH) and **[`projects/+server.ts:85`](../../packages/selva/src/routes/api/v1/projects/+server.ts#L85)** (POST) · **CRITICAL**

PATCH gates exactly one transition — `→ public` (line 86). `platform` is a valid member of `ProjectVisibilitySchema` and flows straight to the store. `validateProjectFlags` only rejects `platform + autoJoinOnUpload`; it never checks who is asking. **There is no `canSetPlatformVisibility` rule in `rules.ts` at all** — the predicate the spec requires doesn't exist.

A plain org `member` with `manage_projects` creates a project (becoming its owner), then PATCHes `visibility: 'platform'`. Result: their own org can no longer see it; `canReclaim` returns false permanently, destroying org leadership's escape hatch; `canManage` narrows to `instance_admin`, locking the creator out too. With `ENABLE_PLATFORM_PROJECTS=false` every rule returns false for everyone — the project is bricked and undeletable.

POST has the same hole at creation ([`projects/+server.ts:85`](../../packages/selva/src/routes/api/v1/projects/+server.ts#L85) assigns `visibility: input.visibility` straight into the record).

**`[upgraded]` — the bricked outcome is the DEFAULT configuration, not an edge case.** [`.env.example:60-61`](../../packages/selva/.env.example#L60-L61): _"PLATFORM FEATURE FLAGS (all default to off)"_, and `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS` is commented out. `readBool(env, 'SELVA_FLAG_…', false)` confirms the default. So on a stock deployment the escalation lands in the branch where **every rule returns false for everyone including instance admins** — permanent, unrecoverable through the UI. The original text presents this as the worst case; it is the normal case.

**Fix:** require `instance_admin` for `visibility: 'platform'` on both POST and PATCH. Prefer one `requireInstanceAdmin` call per route over adding a `canSetPlatformVisibility` rule — see the complexity note at the top.

**Spec:** §4a:236 — _"Only `instance_admin` can create a `platform` project."_ The UI already knows ([`ProjectSettingsDialog.svelte:143-145`](../../packages/selva/src/routes/projects/_components/ProjectSettingsDialog.svelte#L143-L145) hides the option); the API doesn't. **Path corrected** — this file is under `routes/projects/_components/`, not `$lib/components/`.

---

### ✅ 4. Local provider can be driven to zero instance admins through supported API calls

**[`LocalPlatformPermissionStore.ts:98-103`](../../packages/providers/local/src/permissions/LocalPlatformPermissionStore.ts#L98-L103)** · **CRITICAL**

`countOtherAdmins` counts **disabled** admins as live. It has to — `user-data.json` has no `disabled` field; that flag lives in `auth-users.json`, owned by `LocalAuthProvider`. The class doc at :22-25 admits this and says `disableUser` is _"expected to drop the user's `instance_admin` grant via `set` first."_ **It doesn't** — [`LocalAuthProvider.disableUser:173-184`](../../packages/providers/local/src/auth/LocalAuthProvider.ts#L173-L184) only calls `setDisabled`.

Disable Alice (count sees Bob → passes). Disable Bob (count still sees _disabled_ Alice → passes). **Zero enabled admins.** `hasInstanceAdmin` also ignores `disabled`, so `/setup` and the OAuth bootstrap both stay closed. Instance bricked at the application layer, recoverable only by hand-editing JSON.

Supabase filters `disabled = false` correctly ([:101-110](../../packages/providers/supabase/src/permissions/SupabasePlatformPermissionStore.ts#L101-L110)). **The two providers disagree on what "an admin" is.**

**Fix — DECIDED 2026-08-17: `disableUser` revokes `instance_admin` before setting the flag**, which is exactly what `LocalPlatformPermissionStore`'s class doc (:22-25) already promises. Chosen over teaching the permission store to read `auth-users.json` because it keeps the store boundary the class doc deliberately draws — auth owns identity, the permission store owns authorization. Consequence to document: re-enabling a user does **not** restore the grant; an admin must re-tick it. That is the safer default.

**`[verified]`** — `LocalAuthProvider.disableUser` is `findById` → `this.users.setDisabled(id, true)` → return. It never touches the permission store, so the contract its collaborator's doc depends on is simply not implemented.

**`[new]` — the local store also contradicts itself internally.** `assertCanRead` ([:106-111](../../packages/providers/local/src/permissions/LocalPlatformPermissionStore.ts#L106-L111)) denies `manage_instance_users`; `assertCanReadBatch` ([:119-124](../../packages/providers/local/src/permissions/LocalPlatformPermissionStore.ts#L119-L124)) admits it. Same file, same data, two policies — so the same actor gets 403 on `getFor` and 200 on `getForBatch` for the identical row. That inconsistency is what makes finding 5 fail as a 500 on local but at a different point on Supabase, so **a fix validated on one provider will not validate the other.**

**Spec:** §2 — _"Any operation that would leave the instance with zero `instance_admin`s — revoking, deleting, **disabling** — is rejected by the data layer."_

---

### ✅ 5. `manage_instance_users` can delete an instance admin — currently blocked only by accident

**[`api/admin/users/[id]/+server.ts:70-92`](../../packages/selva/src/routes/api/admin/users/[id]/+server.ts#L70-L92)** (DELETE) and **[`disable/+server.ts:19-36`](../../packages/selva/src/routes/api/admin/users/[id]/disable/+server.ts#L19-L36)** · **HIGH**

PATCH is guarded — line 41 refuses a platform-scope change unless the caller holds `instance_admin`, with the stated rationale _"Without this, any org admin with manage_instance_users could self-elevate."_ DELETE and disable have **no equivalent check**, only the last-admin count. Deleting an admin is semantically a platform-permission revocation, so the same rationale applies verbatim.

**The exploit currently fails, for the wrong reason.** The handler pre-reads the target's permissions via `getFor` (line 75), and `assertCanRead` doesn't admit `manage_instance_users` — so it throws an uncaught `ProviderError` that SvelteKit renders as a **500**. Two consequences:

- The natural fix for that 500 is to relax `assertCanRead` (the local store **already did exactly that** for the batch variant — see finding 11), which arms the exploit with no other change.
- `manage_instance_users` currently **cannot disable anyone** — the permission is non-functional for its stated §2 purpose, and returns 500 rather than the 403 §8 requires.

**Fix:** add an explicit `instance_admin` requirement on DELETE/disable when the target holds `instance_admin`. Then the block is deliberate and the 500 can be fixed safely.

---

## P1 — Real damage, needs a precondition

### ✅ 6. No platform-scope domain events exist; permission changes leave no audit trail

**[`packages/platform/src/events/interface.ts:1-77`](../../packages/platform/src/events/interface.ts#L1-L77)** · **HIGH**

The `DomainEvent` union has `org_member.*`, `project_member.*`, `invite.created`, `system.update.*` — and **nothing platform-scope**. No `user.created`, `user.deleted`, `user.disabled`, `platform_permissions.changed`. So none of these emit anything: PATCH granting/revoking `instance_admin`, DELETE user, disable user, POST create-user-with-permissions, the OAuth bootstrap grant, `/setup`'s grant.

A compromised admin can self-elevate a confederate, act, and revoke — leaving **zero rows** in `audit_events`. The one permission that reaches every tenant's data is the one whose changes have no history.

**Spec:** §9 — _"**Every** successful mutation emits an internal domain event."_ §12 leans on this for the audit-log viewer.

**Fix:** add the event types, emit from `setUserPlatformPermissions`, DELETE, disable, and both bootstrap paths.

**`[verified]`, and the good news is the fix is one file.** [`permissions.server.ts`](../../packages/selva/src/lib/server/permissions.server.ts) is 18 lines whose own doc says writes funnel through it _"so any future change (caching, invalidation, audit hooks) is one-file."_ That seam exists and is unused — emitting from there covers most paths at once.

Two corrections: there are **six** silent write paths, not five — the list omits [`accept-invite/+page.server.ts:148`](../../packages/selva/src/routes/accept-invite/+page.server.ts#L148). And neither permission store takes an event sink in its constructor, so the sink has to be wired at the `permissions.server.ts` seam rather than inside the providers.

---

### ✅ 7. `revokeSession` has zero callers — logout doesn't log you out

**[`SupabaseAuthProvider.ts:486`](../../packages/providers/supabase/src/auth/SupabaseAuthProvider.ts#L486)** (impl) · **[`logout/+page.server.ts:6-9`](../../packages/selva/src/routes/logout/+page.server.ts#L6-L9)** · **[`disable/+server.ts:36`](../../packages/selva/src/routes/api/admin/users/[id]/disable/+server.ts#L36)** · **HIGH**

Every hit in the tree is a definition, changelog entry, or doc comment. **Not one caller in application code.**

- **Logout:** `destroySession` is only `cookies.delete()`. The Supabase access token and 30-day refresh token stay valid at GoTrue. Anyone who captured the token keeps a working session. `revokeSession`'s own comment says it exists for this: _"Logout on a shared machine shouldn't leave a sibling session alive."_
- **Disable:** the route's docstring cites _"Permissions.md §10 — disabling a user invalidates sessions"_, then never touches `sessionRefresh`.

| Provider                   | Disabled user's existing session                       |
| -------------------------- | ------------------------------------------------------ |
| Local (HMAC)               | Dies next request — `verifyToken` re-reads the user ✅ |
| Supabase (hybrid, default) | **Survives up to `revalidateMs`, default 60s** ⚠️      |
| Supabase (strict)          | Dies next request ✅                                   |
| header-auth                | Dies next request ✅                                   |

Local and header-auth pass only by accident — they happen to re-read state per request.

~~**Fix:** wire `providers.auth.sessionRefresh?.revokeSession(token)` into both handlers. Two lines each; the method is idempotent and never throws.~~

**Corrected during Pass 3 — this works for logout and is impossible for disable.** `revokeSession` takes the _target's_ session token, which an admin disabling another user does not hold, and no by-user-id revocation exists on the interface or in GoTrue's admin API. Logout is wired; disable's docstring now states the real bound instead. See the Pass 3 section for why closing it properly is separate work.

**`[verified]`** — zero application callers confirmed by full-repo grep; the only hits are the interface definition, the Supabase impl, two changelogs and this document. `logout/+page.server.ts` is 10 lines: `destroySession(cookies)` then redirect. `DEFAULT_REVALIDATE_MS = 60_000` is exact.

Two refinements that **narrow the disable case and leave the logout case as stated**:

- `refreshSession` _does_ check `user_metadata.disabled === true`, so a disabled Supabase user cannot mint fresh tokens past access-token expiry. The real disable exposure is bounded by the access-token lifetime, not the 30-day refresh token. The **logout** exposure is unbounded as written — the refresh token stays valid at GoTrue.
- The `revalidateMs` window is per-`session_id` in an **in-process Map**, evicted past 10,000 entries. On a multi-instance deployment each process holds its own, so "60s" is per-process, not global.

**Spec:** §10's flat _"Sessions invalidated"_ is false for Supabase and false for logout on every provider. Either fix the code or state the bounded window.

---

### ✅ 8. Pending invites survive member removal

**[`members/[userId]/+server.ts:137`](../../packages/selva/src/routes/api/v1/orgs/[orgId]/members/[userId]/+server.ts#L137)** · **HIGH**

`removeOrgMember` touches `org_members` and cascades `project_members` — it never touches the invites table. An unaccepted invite stays live for its full 7-day TTL, and the removed user re-enters at their original role.

Combined with finding 1: an admin mints several dormant `owner` invites and waits. Removing that admin from the org disarms none of them. And `revoke` deliberately skips already-accepted invites, so `DELETE /invites/[id]` can't clear those either.

**Fix:** revoke pending invites by email on member removal.

**`[verified]`, and this is an interface change, not a route fix.** `IInviteStore` exposes only `getByTokenHash`, `listByOrg`, `deleteByOrg` — **no by-email query exists**, so there is nothing for the route to call. The fix adds a store method and implements it in both providers. The "revoke skips accepted invites" sub-claim is confirmed on both sides (`!i.acceptedAt` locally, `.is('accepted_at', null)` on Supabase). Budget this larger than its one-line description suggests.

**Spec:** §10's offboarding list says nothing about pending invites. **Spec gap.**

---

### ✅ 9. Share links survive every form of offboarding, with no UI to find them

**[`shareLinks/resolve.server.ts:51-107`](../../packages/selva/src/lib/server/shareLinks/resolve.server.ts#L51-L107)** · **HIGH**

The resolver validates expiry, revocation, channel, definition liveness and project liveness — it never loads `link.createdBy`, never checks that user's membership or `disabled` state, then mints a `system: true` context that bypasses RLS.

**Spec §10 says this is intentional** (_"Share links the user minted are unaffected"_). The severity is that **the compensating control the design assumes does not exist**:

- [`/team/shares`](../../packages/selva/src/routes/team/shares/+page.server.ts) is a **stub** — returns `{}` after a flag check. The page copy (_"Every active link — definition, channel, label, mint date, mint user"_) is aspirational.
- The only listing is per-definition and requires `requireEditableDefinition`. No query by `createdBy`, no org-wide view.

So the real offboarding runbook is: enumerate every definition in every project the departing user could edit, call the API on each, inspect `createdBy`, revoke by hand. At any scale, that will not happen. `ENABLE_SHARING=false` is the only bulk kill switch and it's instance-wide.

**Fix:** build the `/team/shares` roster with a `createdBy` filter, **or** cascade-revoke on org-member removal. The spec's "unaffected" stance is only defensible with the former.

**DECIDED 2026-08-17 — the roster, and deliberately not the cascade.** Cascade-revoke breaks the wrong people: a departing contractor's demo link dying means the _client_ loses access, and the contractor never needed the link — they had an account. It also only fires on org-member removal, leaving disabled and deleted users' links live, and still answers nothing. The roster is the capability; auto-revoke is a policy that can be layered on top of it later. The reverse does not work. See the Pass 4 section.

---

### ☐ 10. header-auth has no enforceable trust boundary

**[`HeaderAuthProvider.ts:18-34`](../../packages/providers/header-auth/src/HeaderAuthProvider.ts#L18-L34)** · **HIGH**

The provider carries an honest ⚠ TRUST BOUNDARY banner saying the deployment _is_ the security boundary. Verified accurate: no shared secret, no trusted-proxy-IP allowlist, no mTLS. `identifyFromHeaders:144` reads `SELVA-UserPrincipalName` and trusts it completely.

If the app is reachable on any interface other than the proxy's path, `curl -H 'SELVA-UserPrincipalName: admin@corp.com'` authenticates as that admin. There is no credential to steal — **the header is the credential**. And `verifyToken` always returns `null`, so every request takes this path; there's no cookie session fallback.

Mitigations are documented in the README (bind to 127.0.0.1, strip inbound header copies) and enforced nowhere in code.

**Fix (defense in depth):** optional `HEADER_AUTH_SHARED_SECRET` compared with `timingSafeEqual`, or a `TRUSTED_PROXY_IPS` check. Converts a silent total compromise into a failed request.

**`[verified]`** — grep for `SHARED_SECRET|TRUSTED_PROXY|timingSafeEqual|getClientAddress|mTLS` across the whole `header-auth` package returns **zero matches**. `verifyToken` is `async verifyToken(_token) { return null; }`. The provider's own banner says it: _"There is no runtime check that catches a misconfiguration — the deployment IS the security boundary."_

**`[new]` — `rebindUpn` is an identity-takeover primitive, not just impersonation.** [`HeaderAuthProvider.ts:179-187`](../../packages/providers/header-auth/src/HeaderAuthProvider.ts#L179-L187): when the UPN misses but a spoofable `email` header matches an existing allowlist row, the provider adopts that row **and permanently rewrites its UPN** to the attacker-supplied value:

```ts
const byEmail = await this.users.findByEmail(email);
if (byEmail) {
	entry = byEmail;
	if (byEmail.upn !== upn.trim().toLowerCase()) {
		await this.users.rebindUpn(byEmail.id, upn).catch(() => {});
	}
}
```

The comment frames this as an Entra UPN≠mail convenience. Under the spoofing scenario above it is also **persistence**: a real user's account, with its org memberships and permissions, is rebound to a header value the attacker chooses, and the `.catch(() => {})` swallows any failure silently. Whatever gating lands for this finding must cover the email fallback path, not only the UPN one.

---

### ✅ 11. Private project names leak to non-members via `/team/*`

**[`team/reclaim/+page.server.ts:36-52`](../../packages/selva/src/routes/team/reclaim/+page.server.ts#L36-L52)** and **[`team/projects/+page.server.ts:25-37`](../../packages/selva/src/routes/team/projects/+page.server.ts#L25-L37)** · **HIGH**

Neither loader calls `canView`. Reclaim passes **`SYSTEM_CONTEXT`** to `listProjects` and `listProjectMembers`, deliberately bypassing provider-side filtering, then renders name, id, visibility and member count for every project in the org.

`/team/projects` uses `ctx`, which helps only on Supabase — `LocalProjectStore.listProjects` takes `_ctx` (the underscore is load-bearing) and returns every live project in the org.

A plain org `member` granted `manage_projects` — a permission §11 explicitly says an admin may hand to a member — opens `/team/projects` and sees _"Alice — R&D Sandbox — private — 2 members"_: the exact row §11:720 says must not appear.

For `/team/reclaim` the audience is narrower (owner/admin) and the listing is arguably intrinsic to offering reclaim — but §4 says leadership does not automatically see private projects, and this is a silent leadership read with **no audit event**, which is precisely the "silent default" §4:175 rejects.

Correct implementations to copy: [`projects/+page.server.ts:100-107`](../../packages/selva/src/routes/projects/+page.server.ts#L100-L107) and `visibility.server.ts:86-94`.

**`[verified]`, and understated in two ways.**

`/team/projects` renders a live **Delete** button for every row (`+page.svelte:192-200`), including private projects the caller cannot view. `DELETE /api/v1/projects/{id}` is guarded by `requireCanManage`, so it is a misleading affordance rather than an exploit — but the page offers destruction of projects it should not be naming.

The two loaders have **different audiences**, which the shared heading obscures: `/team/reclaim` gates on `manage_org_members` (owner/admin only — narrow, and the listing is arguably intrinsic to offering reclaim), while `/team/projects` gates on `manage_projects`, which §11 says an admin may hand to a plain member. **`/team/projects` is the finding; reclaim is the lesser half.**

Root cause is the `_ctx` pattern named at the top: `LocalProjectStore.listProjects(_ctx, orgId, …)` filters on `p.orgId === orgId && isLive(p)` and nothing else. Supabase filters correctly via `forRequest(ctx)` → user-JWT client → RLS.

**DECIDED (Pass 5) — fixed at the route, not in the store.** `listProjects` stays `_ctx`: it is a raw read, and three callers pass `SYSTEM_CONTEXT` on purpose because they must see past the caller's visibility. `/team/projects` now filters through `resolveAccessibleProjects(ctx)`, so both providers agree because neither decides. `/team/reclaim` is deliberately left unfiltered and now documents why — reclaim exists to reach exactly the projects leadership cannot view, and its escalation is already audited via `project_member.added`.

---

### ✅ 12. Supabase RLS diverges from `rules.ts` on three points

**[`20260425155514_selva_initial.sql`](../../packages/providers/supabase/supabase/migrations/20260425155514_selva_initial.sql)** · **MEDIUM**

`rules.ts:10-11` promises: _"Mutating store methods MUST re-enforce the same predicate independently (RLS in SQL, code in local/JSON)."_ Three mismatches:

1. **`visible_project` has no `platform` branch** (lines 299-314). Platform projects have no member rows, so they fall through to invisible — accidentally fail-closed, but it means **`PlatformProjectGrant` is enforced nowhere in SQL.** RLS isn't a second line of defense here; it's absent.
2. **`public` ignores `ALLOW_CROSS_ORG_PUBLIC`** (line 309 is a bare `visibility = 'public'`). With the flag off, RLS is _more permissive_ than the rule.
3. **Project mutation policies key on `owner_id`, not member role** (lines 388-397). These diverge exactly after a **Reclaim**: the reclaiming admin gets a `project_members` row with `role: 'owner'` but `projects.owner_id` still points at the original owner. So `requireCanEditProjectSettings` passes at the app layer and the UPDATE is then rejected by RLS — **reclaim is functionally broken for settings edits on Supabase.**

Read from migrations, not a running DB — worth confirming against a live instance.

**`[verified]` — all three, and no later migration redefines `visible_project`** (subsequent migrations touch only `user_profiles` policies). RLS is genuinely live for a non-system ctx: `client.ts:89` routes `ctx.system` to the service-role client and everything else to a user-JWT client, so these policies do apply in practice. The reclaim break is confirmed: `reclaim/+server.ts` inserts a `project_members` row with `role: 'owner'` and never touches `projects.owner_id`, while the policy reads `using (selva.is_instance_admin() or owner_id = auth.uid())`.

**`[new]` — a fourth divergence:** the `project_members` SELECT policy is `visible_project(project_id)`, so on a **public** project any authenticated user can read the full member roster — not just leadership. That is a membership disclosure the app layer does not intend.

**DONE (Pass 7)** — `20260817160000_rls_matches_access_rules.sql`, verified against a live stack. **Two of the four are closed; two are deliberately left open and now say so in the migration.** #3 (the reclaim break) and #4 (the roster) are fixed. #1 (`platform`) is an unbuilt feature on this provider — the `visibility` CHECK does not even admit the value and the grant store throws 501, so the branch is part of shipping platform projects, not of closing a drift. #2 (`ALLOW_CROSS_ORG_PUBLIC`) is a deploy-time env flag Postgres cannot read; mirroring it into the DB creates a second source of truth that can disagree with the first, which is a worse failure than the one it fixes. See the Pass 7 section.

---

## P2 — Correctness, hygiene, spec drift

### ☐ 13. Removing a member from a public/org project revokes nothing, and the UI implies it does

**[`rules.ts:85-87`](../../packages/platform/src/access/rules.ts#L85-L87)** · **HIGH (UX), not a rule bug**

Only the `private` branch consults `member`. This is **correct per §4** — there is no deny-list concept in the model. The trap is the UI:

- [`ProjectSettingsDialog.svelte:160`](../../packages/selva/src/routes/projects/_components/ProjectSettingsDialog.svelte#L160): _"Add members to control who can edit this project."_ — frames membership as the access mechanism.
- Lines 191-199: removal is a bare `X` with no confirmation and no visibility-dependent copy.
- `+page.svelte:287-292`: success does nothing but refresh. **The absence of an error reads as success.**

This is the finding that started the audit. An admin offboarding a contractor from a `public` project sees the row vanish and reasonably concludes access is revoked. It isn't — they keep full view + solve via visibility, plus any share links they minted (9), plus edit rights on their own definitions if `autoJoinOnUpload` is set (15).

**Fix:** on a non-private project, the Members tab must state that visibility grants access independently, and removal must confirm with visibility-aware copy.

**`[verified]`** — copy quoted accurately (**path corrected** to `routes/projects/_components/`). The sharper diagnosis: `visibilityHint` at :62-64 is individually correct for each visibility, but it sits in the **Settings** tab while the **Members** tab says membership controls editing. Neither string is false; the two tabs are jointly misleading. Fixing the Members copy alone will not resolve it — the two tabs have to agree.

---

### 🧊 14. `canChangeVisibilityToPublic` never runs for `private → org` — DEFERRED, deliberate

**[`api/v1/projects/[id]/+server.ts:86`](../../packages/selva/src/routes/api/v1/projects/[id]/+server.ts#L86)** · **MEDIUM**

The gate is `input.visibility === 'public' && existing.visibility !== 'public'`. A plain org `member` with `manage_projects` can create a private project, upload sensitive material, then PATCH `visibility: 'org'` — exposing it to every org member with no leadership check.

The code matches the letter of §5 (which names only the `public` flip), but the spec's own justification — _"Flipping a project to `public` is a disclosure action"_ — applies with equal force to `org` on a large org. **Spec gap needing an explicit decision.**

For the record, the `→ public` gate itself is faithful and a project owner who is a mere org `member` **cannot** make a project public.

**DECIDED 2026-08-17 — deferred, not fixed.** `org` visibility exposes a project only inside the tenant that already owns it, so the disclosure boundary the `→ public` gate defends is not crossed. Gating `private → org` on leadership would make a plain member unable to share their own project with their own colleagues — a real cost against a small risk. **Action is on the spec, not the code:** §5 should state that `org` is intentionally ungated and say why, so the asymmetry with `→ public` reads as a decision rather than an oversight. Revisit if orgs grow large enough that "everyone in the org" stops being a meaningful trust boundary.

---

### ☐ 15. Flipping `autoJoinOnUpload` retroactively grants edit rights to departed users

**[`rules.ts:198`](../../packages/platform/src/access/rules.ts#L198)** · **MEDIUM**

`canEditDefinition` evaluates `project.autoJoinOnUpload` live at check time against `definition.ownerId`, which is stamped at creation and never revisited. Flipping the flag true makes every pre-existing definition editable by whoever uploaded it — **including users long since removed from the project or org**. They regain edit, delete, and share-link-mint authority.

§4:218 is self-contradictory here — _"grants the commons contract to new definitions only; existing ones … with their `createdBy` user treated as the definition owner retroactively."_ Both clauses can't hold. The code implements the second. **Spec needs rewriting; code needs a decision.**

**`[verified]`, with one correction to the reasoning.** The rule behaves as described. But `ownerId` is **not** immutable in code: `DefinitionRecordPatch` includes `ownerId?: string` and `LocalDefinitionStore` applies it. No route currently sends it, so the conclusion holds in practice — but the spec's _"It never changes"_ (Permissions.md:672) is enforced by convention, not by the type. A future patch route wiring `ownerId` through would silently transfer edit rights on a commons project.

---

### ☐ 16. Reclaim emits no distinguishable event

**[`api/v1/projects/[id]/reclaim/+server.ts:12-32`](../../packages/selva/src/routes/api/v1/projects/[id]/reclaim/+server.ts#L12-L32)** · **MEDIUM**

`addProjectMember` does emit `project_member.added`, so a row exists — but `DomainEvent` has no `project.reclaimed` variant, and the emitted event is byte-identical to a routine "owner adds a member." An auditor cannot distinguish _"org admin escalated into a private project they had no membership in"_ from _"project owner added a teammate."_ The only signal is `actorId === userId`, which is inferential and undocumented.

§4:175 calls the audit trail _"the load-bearing protection"_ in present tense; §11:714 admits _"Audit entry (future)."_

**Also:** `requireCanReclaim` wraps in `managementBypassOrRun`, so `instance_admin` short-circuits before `canReclaim` runs — meaning **an instance admin can reclaim a `platform` project**, despite `rules.ts:220` returning false and §4a:284 + §11:739 mandating 403. Benign in effect, live divergence from a spec line written to prevent it.

**Fix:** add `{ type: 'project.reclaimed'; projectId; orgId; actorId; priorVisibility }`.

---

### ☐ 17. TOCTOU on the last-admin invariant

**Local [`set:71-81`](../../packages/providers/local/src/permissions/LocalPlatformPermissionStore.ts#L71-L81)** · **Supabase [`set:63-83`](../../packages/providers/supabase/src/permissions/SupabasePlatformPermissionStore.ts#L63-L83)** · **MEDIUM**

Read-then-write with no lock, transaction, `SELECT … FOR UPDATE`, or conditional `UPDATE`. Two concurrent demotions each count the other admin, both pass, both commit → zero admins. Same race across DELETE + disable pairs; they share no mutual exclusion.

§7's share-link counter is explicitly a single atomic statement _"because a check at resolution would race"_ — the pattern is known, just not applied here. Supabase is the worse case (genuinely concurrent across app instances).

---

### ✅ 18. Stores disagree on who may batch-read platform permissions

**Local [`assertCanReadBatch:119-124`](../../packages/providers/local/src/permissions/LocalPlatformPermissionStore.ts#L119-L124)** admits `manage_instance_users`; **Supabase [`getForBatch:43`](../../packages/providers/supabase/src/permissions/SupabasePlatformPermissionStore.ts#L43)** is `instance_admin`-only · **MEDIUM**

On local, a `manage_instance_users` holder loads `/admin/users` and sees exactly who holds `instance_admin` — the reconnaissance step for findings 4 and 5. On Supabase it throws, the catch swallows it (checks `.status`, `ProviderError` has `.statusCode`), and the page renders _"User store unavailable"_ — a misleading error for a permission denial.

Local matches §8; Supabase is the deviation. **Note the conflict:** aligning Supabase _up_ to local re-arms finding 5. Fix 5 first.

**`[verified]`, and the real defect is bigger than the field-name mismatch.** The catch at [`admin/users/+page.server.ts:88-90`](../../packages/selva/src/routes/admin/users/+page.server.ts#L88-L90) is:

```ts
} catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
}
```

It wraps a block spanning `listUsers`, `getProfiles`, `getForBatch` **and** `listAllOrgMembers`, swallows **every** error from all four, and logs nothing. Any provider outage or bug anywhere in that path renders as _"configure DATA_PATH."_ Correcting `.status` → `.statusCode` fixes the 403 symptom and leaves the blanket swallow in place — fix both.

**DONE (Pass 5), both halves.** Supabase gained `assertCanReadBatch` and admits the role on `getFor` too; `set` stays `instance_admin`-only, so read access does not become authority. Three conformance cases pin all three facts for **both** providers. The catch now separates "provider has no user store" (renders wiring advice) from a `ProviderError` (re-thrown at its own status) from anything else (logged, then degrades).

---

### ☐ 19. Admin UI delete button doesn't mirror the server

**[`UserListItem.svelte:147`](../../packages/selva/src/routes/admin/users/UserListItem.svelte#L147)** · **MEDIUM**

`disabled={deleting || soleInstanceAdmin}` — not gated on `isPlatformAdmin`. A `manage_instance_users` holder sees a live Delete button on every admin row. The UI is _offering_ finding 5's exploit as one click. Checkboxes mirror correctly (`platformLocked = !isPlatformAdmin`); delete does not.

Also: `soleInstanceAdmin` is computed client-side over a 200-row page, so the lock §2 asks for is computed on truncated input. Disable has **no UI at all** and there's no enable endpoint — currently a one-way door.

---

### ☐ 20. Smaller items

**All eleven verified TRUE.** One has been promoted out of this list: _"`/setup` action doesn't re-check `hasInstanceAdmin`"_ is now **finding 0** at the top — it is an unauthenticated privilege escalation, and its "mitigated by duplicate-email rejection" caveat was wrong (a _fresh_ email succeeds).

- **`hasAnotherOwner` pagination ceiling** — [`members/[userId]/+server.ts:45`](../../packages/selva/src/routes/api/v1/orgs/[orgId]/members/[userId]/+server.ts#L45) uses `limit: 200` with no cursor loop; fails closed (availability, not security). A correct paginating sibling exists — `listAllOrgMembers`, used by `admin/users/+page.server.ts:65`.
- **Org DELETE lacks the owner-only gate org PATCH has** — an admin gets 403 demoting an owner but 204 removing one, whenever a second owner exists. Feeds finding 1's chain. Confirmed: PATCH:74 has `if (actorMember.role !== 'owner')`; DELETE:118-140 has only `requireManageOrgMembers` + `hasAnotherOwner`.
- **`updateOrgMemberRole` re-seeds permissions from the role** in both providers (`LocalOrgStore.ts:298`, `SupabaseOrgStore.ts:339`, both `[...DEFAULT_ORG_PERMISSIONS[role]]`). Spec never states whether custom grants survive a role change. **Spec gap.**
- **Removing an org member can strip a project of its sole owner** — confirmed in both providers; the cascade soft-deletes every `project_members` row with no `checkOwnerRemoval`. Contradicts §10's _"removal is blocked until a new owner is assigned."_
- **Draft-channel solve reachable by commons definition owners** — [`solve.server.ts:204-220`](../../packages/selva/src/lib/server/compute/solve.server.ts#L204-L220) routes draft to `canEditDefinition`, whose commons branch (`rules.ts:198`) admits non-members. §6 says draft is owner/editor **only**. Both statements can't be true.
- **`auth-bootstrap.server.ts:49` early-return** skips the single-tenant default-org self-heal for a non-matching signer. Narrower than it reads — it only fires while no admin exists, so no org exists to find anyway; the cost is that the _next_ matching signer must trigger the seed, and the non-matching user's session is a dead end meanwhile.
- **Bootstrap race** — two simultaneous OAuth callbacks on a fresh single-tenant install both observe no admin and both get `ALL_PLATFORM_PERMISSIONS`. Same read-then-write shape as finding 17. §2 says "first signer wins"; the code lets both win.
- **CSRF is form-only** — **`[partly corrected]`** no `csrf.checkOrigin` override exists in `svelte.config.js`, so SvelteKit's default is active: it checks `Origin` on form-like content types, **not** on `application/json`. The practical characterization stands. The frame-header half is confirmed, but the omission is implemented in `applySecurityHeaders` in `@selvajs/server/http`, not at the cited `hooks.server.ts:379` (which is only the comment).
- **No rate limit on permission-mutation endpoints.** Login is well done (`checkRateLimit` peeks before parsing the body; `clear` on success). **`ADDRESS_HEADER`/`XFF_DEPTH` appear nowhere in the repo** — not in `.env.example`, no README, no deploy script. Under header-auth behind a proxy `getClientAddress()` returns the proxy IP, so every user genuinely does share one bucket, and operators have no documented way to fix it.
- **Stale comment** — [`projects/+page.server.ts:44`](../../packages/selva/src/routes/projects/+page.server.ts#L44) claims _"`instance_admin` always edits via the centralized bypass"_. Contradicted 40 lines later in the same file (:85-86) and by `access.server.ts:149-154`. A maintainer could "restore" the bypass it describes and break §2.

---

## P1/P2 — found during the verification pass

### ✅ 21. `GET /definitions/{guid}/versions` is a cross-tenant existence oracle

**[`api/v1/definitions/[guid]/versions/+server.ts:25-27`](../../packages/selva/src/routes/api/v1/definitions/[guid]/versions/+server.ts#L25-L27)** · **MEDIUM** · **`[new]`**

```ts
const def = await getDefinitionMeta().get(locals.ctx, guid);
if (!def) apiError(404, ApiErrorCode.NOT_FOUND, 'Definition not found');
await requireCanViewProject(locals, def.projectId);
```

Its two sibling routes (`[guid]/+server.ts:35`, `[guid]/schema/+server.ts:22`) both resolve through `getVisibleDefinition`, whose doc states the reason verbatim: _"Returns `null` rather than throwing 403 … a public API that answers 'forbidden' for a guid the caller cannot see turns `/definitions/{guid}` into a cross-tenant existence oracle."_ This route 403s where its siblings 404. Compounding it, `LocalDefinitionStore.get` takes `_ctx` — the same `_ctx` pattern — so the pre-read is unfiltered on the local provider.

Secondary: the guard is `requireCanViewProject`, not `requireEditableDefinition`, so any org member on an `org` project (or any authenticated user on a `public` one) can enumerate `uploadedBy`, `changeNote` and version history — editorial metadata every other version surface gates on edit rights.

**Fix:** route it through `getVisibleDefinition` like its siblings. One line, and it closes the oracle. Decide separately whether history is view- or edit-scope.

---

### ✅ 22. `requireCanEdit` is dead code sitting beside two byte-identical guards

**[`access.server.ts:180-188`](../../packages/selva/src/lib/server/access.server.ts#L180-L188)** · **LOW (hygiene, high trap potential)** · **`[new]`**

`requireCanEdit` is exported and has **zero production callers** (the only repo hit outside its definition is a doc comment in `fixtures.ts:690`). Meanwhile `requireCanManage` and `requireCanManageMembers` (:294-315) have byte-identical bodies, differing only in error string.

Three near-identical guards, of which the unused one is **the weakest** (content-scope, no `instance_admin` bypass) and has **the most inviting name** — the one a future author reaches for by default.

**Full dead list — seven symbols, all in this one file.** `access.server.ts` is `$lib/server`, app-internal, exported from no package barrel, so none of this is public API and all of it is safely deletable:

| Symbol                         | Line | Note                                                                                                                                                                                                                                                     |
| ------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requireCanEdit`               | :180 | only surviving mention is a JSDoc example in `fixtures.ts:690`                                                                                                                                                                                           |
| `requireManageDefinitions`     | :72  | zero references repo-wide                                                                                                                                                                                                                                |
| `requireManageProjects`        | :74  | zero references repo-wide                                                                                                                                                                                                                                |
| `assertManageDefinitions`      | :81  | zero references repo-wide                                                                                                                                                                                                                                |
| `assertManageProjects`         | :83  | zero references repo-wide                                                                                                                                                                                                                                |
| `throwProviderError`           | :32  | bare alias for `handleApiError`; everyone imports the original                                                                                                                                                                                           |
| `requireAnyPlatformPermission` | :115 | **looks used, isn't** — its only hit is a string literal in `conformance.test.ts`'s `NAMED_GUARDS` array, which scans handler source text and never calls the function. `assertAnyPlatformPermission` (:123) _is_ genuinely used by the `/admin` layout. |

**Deleting these removes no enforcement.** `manage_definitions` and `manage_projects` are still enforced — through `canCreateProject` (`rules.ts:245`), a direct `hasPermission` call at `team/projects/+page.server.ts:14`, and RLS at `20260425155514_selva_initial.sql:382`. The wrappers were simply never adopted: the generic `requirePermission(locals, 'x')` is called directly **12 times** while its named aliases sit at zero. An abandoned convention, not a missing one.

**Fix:** delete all seven; collapse `requireCanManageMembers` into `requireCanManage` or give it a distinct check. This is the one item on the list that makes the system _smaller_.

---

### ✅ 23. Compute-server inventory is not scoped in the store

**[`team/compute/+page.server.ts:44-63`](../../packages/selva/src/routes/team/compute/+page.server.ts#L44-L63)** and **[`api/v1/orgs/[orgId]/compute/+server.ts:50-68`](../../packages/selva/src/routes/api/v1/orgs/[orgId]/compute/+server.ts#L50-L68)** · **MEDIUM** · **`[new]`**

`getComputeServerConfigStore().getConfig(ctx)` returns the **whole instance's** server list — every platform server and every other org's org-private servers. The interface comment says so outright (_"the store does not pre-filter"_), and `LocalComputeServerStore.getConfig` takes `_ctx`.

Both callers do filter (`ownServers` by `ownerOrgId`, `catalog` via `serversVisibleTo`), so today's exposure is limited — but `globalDefaultServerId: config.defaultServerId ?? null` passes through unfiltered, and the design rests on two independent call sites each remembering a filter the store refuses to apply. `apiKey` **is** correctly stripped by the response schema, so this is internal network topology (Rhino.Compute hostnames), not credentials.

This is the exact failure mode CLAUDE.md names: _"a rule that two endpoints must agree on belongs in `$lib/server/`, not copied into both."_

**Fix:** have `getConfig` take the scoping org and filter in the store, so a third caller cannot forget.

---

### ✅ 24. Implicit-project fallback on definition upload picks before it checks

**[`api/v1/definitions/+server.ts:86-96`](../../packages/selva/src/routes/api/v1/definitions/+server.ts#L86-L96)** · **LOW-MEDIUM** · **`[new]`**

With no `projectId` in the body, the route takes `listProjects(ctx, actingOrgId, { limit: 1 })` and uploads into whatever sorts first. On local that listing is unfiltered (`_ctx` again), so the fallback can be a `private` project the caller isn't a member of. `requireCanCreateDefinition` catches it (403) — **except** on `autoJoinOnUpload` projects, where its commons branch returns `true` for any authenticated user ([`access.server.ts:203`](../../packages/selva/src/lib/server/access.server.ts#L203)), so the upload lands in a project the caller never named.

**Fix:** make `projectId` required, or resolve the fallback from the caller's `canView`-filtered set.

---

### ✅ 25. Share-token context is indistinguishable from an admin context at the store layer

**[`shareLinks/resolve.server.ts:98-104`](../../packages/selva/src/lib/server/shareLinks/resolve.server.ts#L98-L104)** · **LOW (no live exploit)** · **`[new]`**

The synthetic ctx is `{ userId: '', actingOrgId: project.orgId, platformPermissions: [], orgPermissions: [], system: true }`. Because every store guard begins `if (ctx.system) return`, **an anonymous share-link holder's context satisfies `assertAdmin`.** No current call path abuses it — but `runSolve` already passes this ctx to three mutating methods (`tryIncrementSolveCount`, `setVersionSchema`, `incrementSolveCount`), so nothing structural stops a fourth.

Second-order: `actorFrom(ctx)` yields `''`, which [`admin/audit/+page.server.ts:257`](../../packages/selva/src/routes/admin/audit/+page.server.ts#L257) renders as **"System"**. An anonymous share-link solve that triggers a schema backfill writes an audit row attributed to the platform itself.

**Fix:** give the share ctx a sentinel actor (`share:{link.id}`) and a narrower capability flag than blanket `system: true`, so it cannot satisfy `assertAdmin`.

---

## Maintainability review

Separate pass, run 2026-08-17 against the same code, asking a different question: **is this system simple enough to keep correct after the findings above are fixed?** Two independent agents plus direct reading.

**Verdict: the layer is soundly designed. Do not restructure it.** The items below are small and additive-free; nothing here argues for an architectural change. Recorded so a future audit doesn't re-derive them, and so the "elegant to maintain" goal has a checklist.

### What is already right — protect these

- **Permission enums derive everything from one source.** `OrgPermissionSchema` (`organizations/schemas.ts:65`) and `PlatformPermissionSchema` (`permissions/types.ts:11`) are Zod enums; `ALL_*_PERMISSIONS` come from `.options`, `MEMBER_ASSIGNABLE_PERMISSIONS` is computed by _subtracting_ `OWNER_ADMIN_ONLY_PERMISSIONS`, and `DEFAULT_ORG_PERMISSIONS` spreads the derived array. **Adding an org permission is one line** (two if it's governance-scope) and the member ceiling updates itself. This is the property to defend in review.
- **`rules.ts` is pure, fully tested, and every export has a live caller.** No dead rules.
- **`managementBypassOrRun` vs `contentCheck`** (`access.server.ts:141-154`) is the sharpest thing in the guard layer. `contentCheck` being a one-line passthrough is deliberate and worth keeping — it marks call sites as _intentionally_ bypass-free rather than accidentally so.
- **`route.ts` / `bodies.ts` / `responses.ts` is not ceremony.** `shaped()` is load-bearing security: it inverts the default so a store field like `tokenHash` or `apiKey` cannot leak when someone adds it to a type. Keep.
- **`project-access-input.ts` earns its place** — it centralizes "which rows does each visibility need", which would otherwise be mis-fetched per route, and the `buildProjectAccessInput` / `projectAccessInputFromRows` split is a real N+1 fix.
- **Three sole-owner checks are three different invariants** (project / org / instance) over three tables, each already delegating to a shared function. **Not duplication — leave them.**
- **Last-admin logic in both permission stores** is a provider-interface contract with a shared conformance suite (`platformPermissionStoreSuite.ts:134`). Two implementations of one tested contract is correct.

### ✅ 26. Visibility is the sprawl point — and it is why finding 3 exists

**[`rules.ts`](../../packages/platform/src/access/rules.ts)** · **REAL DEBT** · **`[new]`**

`rules.ts` carries **7 separate `visibility === 'platform'` branches** and **12 `enablePlatformProjects` mentions** in 270 lines. Every rule re-checks the discriminant and re-checks the flag independently. Adding a visibility means remembering all seven — and this is precisely the shape that let finding 3 through: there is no single place where "who may set this visibility" could have been asked.

Adding a project visibility today touches ~8 production files: the enum in `projects/schemas.ts`, the seven branches here, `project-access-input.ts:87`, `definitions/visibility.server.ts` (:75, :151), the admin project routes (four `=== 'platform'` compares), `ProjectSettingsDialog.svelte:60-66`, `DefinitionCard.svelte:14`, and the RLS migration.

**One site fails silently and should be fixed regardless:** [`api/v1/projects/[id]/+server.ts:122`](../../packages/selva/src/routes/api/v1/projects/[id]/+server.ts#L122) hand-writes the union `'public' | 'org' | 'private' | 'platform'` instead of importing `ProjectVisibility`. A new enum member type-checks here and is then silently dropped from the patch. `DefinitionCard.svelte:14` re-declares the union inline too.

**Fix:** import `ProjectVisibility` at both sites (one line each). Do **not** restructure the seven branches — a visibility-behaviour table sounds tidy but would obscure rules that genuinely differ per function. Note the count in review instead.

**DONE (Pass 6).** Both sites import `ProjectVisibility` now (the projects PATCH route landed in Pass 1, `DefinitionCard.svelte` in Pass 6). The seven branches were deliberately left alone, as the finding itself advises.

---

### ✅ 27. `SettingsMenu.svelte` hand-copies both permission arrays

**[`SettingsMenu.svelte:21-32`](../../packages/selva/src/lib/components/SettingsMenu.svelte#L21-L32)** · **MEDIUM** · **`[new]`**

`ANY_PLATFORM_PERM` and `ANY_ORG_ADMIN_PERM` are inline literal arrays duplicating `ALL_PLATFORM_PERMISSIONS` and `ALL_ORG_PERMISSIONS`. They are typed `PlatformPermission[]` / `OrgPermission[]`, so **adding a permission compiles clean and the menu silently stops appearing for its holder.**

This is the one place the excellent "one line to add a permission" property above breaks. `admin/users/+page.svelte:6` does it correctly by importing the constant — two files in the same app, two conventions. (`conformance.test.ts:308-313` holds a third copy, which is acceptable in a test asserting the shape.)

**Fix:** import the constants. One line.

---

### ✅ 28. Slug-collision retry is copied between v1 and admin, and has already drifted

**[`api/v1/projects/+server.ts:78-116`](../../packages/selva/src/routes/api/v1/projects/+server.ts#L78-L116)** and **`api/admin/projects/+server.ts:94-136`** · **REAL DEBT** · **`[new]`**

Same `MAX_SLUG_ATTEMPTS = 25`, same two predicates matching **Postgres constraint names via regex against an error message**, same retry loop — copied. **This is the only place in the access surface where copies have genuinely diverged:**

- v1 rethrows non-slug errors (`if (!isSlugConflict(err)) throw err`); admin handles inline (`if (isSlugConflict(err)) continue; handleApiError(...)`)
- v1 seeds `|| 'project'`, admin `|| 'platform-project'`
- **v1 POST validates `autoJoinOnUpload` requires public (:66); admin POST does not** — defensible only because admin hardcodes `autoJoinOnUpload: false`, and nothing enforces that link

Matching a DB constraint name with a regex is exactly the fragile thing that should exist once.

**Fix:** extract `createProjectWithUniqueSlug(ctx, draft)` into `$lib/server/projects/`. Related: `validateProjectFlags` is called only from PATCH (`[id]/+server.ts:106`) while v1 POST hand-rolls the same invariant at :66 — POST should call it.

**DONE (Pass 6).** Extracted to `$lib/server/projects/createProject.server.ts`; both routes call it, and v1 POST now calls `validateProjectFlags` instead of its hand-rolled copy. The three drifts resolved as: the helper always re-throws non-slug errors (v1's behaviour — admin's inline `handleApiError` in the loop was the more surprising one), and slug stem plus conflict-message scope became per-caller options rather than being unified into a wrong single value.

**The extraction found a gap the finding did not name: neither copy had a test.** A regex against a Postgres constraint name gates the whole retry, so a renamed constraint would silently stop it retrying and turn a routine collision into a 500 — and nothing would have caught that. Eight cases now cover the helper (retry, run of collisions, fallback stem, name-conflict-does-not-retry, unrelated-error-escapes, exhaustion, timestamp stamping).

---

### ✅ 29. Smaller maintainability items

- ✅ **`permissions-compat.server.ts` is misnamed, not dead.** `splitFlatPermissions` has one live caller (invites POST) and is a wire-format adapter, not a migration shim — the v1 invite body takes a flat `permissions[]` while adapters need two scopes. Only the name misleads: "compat" reads as legacy cruft and will be flagged by every future audit. **Rename to `permissions-scope.server.ts`; do not delete.** — **DONE (Pass 6)**, renamed via `git mv`; the header no longer reads as a shim awaiting retirement.
- ✅ **"Platform permissions are not delegable" is copied 3×** — `invites/+server.ts:50` (whose comment at :48 openly admits _"Same rule as POST /api/admin/users"_), `admin/users/+server.ts:72`, `admin/users/[id]/+server.ts:41`. All three currently **agree**. The clearest case of the CLAUDE.md rule being broken by a comment that knows it. Fix: a ~6-line `assertCanGrantPlatformPermissions(ctx, requested)` in `access.server.ts`. — **DONE (Pass 6)**, with one shape change: the helper takes an optional `current`, because PATCH gates on _change_ (revoking an admin is a platform-scope write too) while the two create paths gate on _grant_. Folding those into one predicate without `current` would have let a `manage_instance_users` holder strip the admins above them by PATCHing `[]`.
- ✅ **Last-instance-admin check copied 2×** in `admin/users/[id]/+server.ts:75-85` and `disable/+server.ts:24-34`; identical apart from the verb in the message. One `requireNotLastInstanceAdmin(ctx, id, verb)` helper. Fold into the finding 5 fix, which touches both handlers anyway. — **DONE in Pass 1** as `requireCanRemoveInstanceAdmin(ctx, id, verb)` in `$lib/server/admin/instanceAdmins.server.ts`.
- **`admin/*` never adopted `apiRoute`** — 0 of 22 handlers, vs 40 of 43 in v1. Drift, not design: admin routes hand-roll `if (!id) apiError(400, …)` (what `requireParams` exists for) and repeat `try/catch` in every handler. Converging is mechanical, ~2–3h, roughly **−80 lines**. Worth doing _after_ the security findings, because shared helpers are where a future rule change lands and admin routes currently cannot receive one. Three v1 stragglers (`v1/compute`, `v1/compute/schema`, `v1/definitions/[guid]/solve`) are streaming/solve paths — check before converting.
- **Three permission-label maps** (`UserListItem.svelte:35,46`, `team/members/+page.svelte:71`, `admin/users/+page.svelte:32`) are `Record<Permission, string>`, so TypeScript **does** force updates. A cost, not a hazard. Leave.

---

## Verified correct — do not regress

Worth recording, because several of these are better than typical and a future refactor could quietly undo them.

**Re-checked in the verification pass: every claim in this section held.** Nothing here was wrong. Three were spot-checked in depth and are annotated below.

- **Permission propagation has zero staleness.** `buildContext` runs on every authenticated request with four live provider reads ([`hooks.server.ts:309-318`](../../packages/selva/src/hooks.server.ts#L309-L318)). `ctx` is never cached. `ensuredUserIds` memoizes only an existence-write, never permissions. **Guard against a future "optimization" that caches `getFor` per-process.** **`[verified]`** — and there are **two** call sites, not one: :318 for authed requests and :366 on the public-page session-attach path. Both build fresh.
- **`actingOrgId` is not forgeable.** Assigned in exactly one place, from a DB read keyed on the authenticated user ID. No cookie, header, or query source exists. All 7 org routes call `requireActingOrg`. **`[verified]`** — the only production assignments are in `buildContext` (`hooks.server.ts:91/95/106`), all server-derived; every other hit is a test fixture or a read. The share-link resolver sets it from the resolved project, not from the request.
- **The `instance_admin` content bypass boundary holds.** `contentCheck` is a genuine no-op wrapper; every `isInstanceAdmin` call in `rules.ts` sits inside a `visibility === 'platform'` branch. `/projects` filters through `canView` with no bypass.
- **Share links match §7 closely** — 256-bit entropy, hash-as-lookup-key (sidesteps timing comparison entirely), strict `(definitionId, channel)` pinning, atomic increment via RPC on Supabase and a tested read-modify-write locally. **`[verified]`** — `randomBytes(32)` = 256 bits, HMAC-SHA256 lookup key, `getByTokenHash` never compares raw tokens. (Separate from the _context_ the resolver mints — see new finding 25.)
- **`[new]` Version-id/guid pairing is not an IDOR.** `loadVisibleVersion` re-checks `version.definitionId !== record.guid` on all three routes that use it; `share-links/[linkId]` DELETE re-derives ownership rather than echoing it. Verified during the new-findings sweep.
- **Files proxy is per-resource authorized** — path re-derived from `definitionPaths.image(guid)` rather than echoed, so traversal is blocked twice over. Removed members get 403 immediately.
- **Platform project grants** are correctly admin-gated with immediate hard-delete revocation.
- **OAuth bootstrap implements the §2 tenancy matrix correctly** and is well tested.
- **Logging hygiene is clean.** `hooks.server.ts:165-167` deliberately binds `url.pathname` and never `.search`, because _"query strings carry share tokens, and a log record outlives the token's usefulness to an attacker."_
- **Org-scope PATCH is the model to copy** — owner-only role gate, sole-owner protection, member-permission ceiling, all with adversarial tests in `patch-member-escalation.test.ts`.

---

## Test debt

**`[corrected]`** — the original framing ("route handlers are almost entirely unexercised") was too broad. There are 38 test files, a working harness, and genuinely adversarial route tests. The accurate statement is narrower and more useful:

**Tests cover the escalation vectors someone already thought of, one axis at a time.** `invites/__tests__/platform-permissions.test.ts` closes the platform-scope door thoroughly — and passes `orgRole: 'member'` in every single case, leaving the org-scope door (finding 1) untried. `scenarios.test.ts` tests `checkOwnerRemoval` as a pure function; no test invokes the project-members PATCH route that forgets to call it.

Good news for the fixes: **`freshProviders` / `actAs` / `call` already exist** (`$lib/server/__tests__/fixtures.ts`), so each test below is a short file, not new infrastructure.

Highest-value tests to add, in order:

1. **POST to `/setup` on an instance that already has an admin** (finding 0) — the only unauthenticated escalation.
2. Invite with `orgRole: 'owner'` minted by a non-owner (finding 1) — and the full takeover chain through accept.
3. Project members **PATCH route** — sole-owner demotion, owner-on-owner without confirm (finding 2).
4. `visibility: 'platform'` via POST and PATCH by a non-admin (finding 3) — assert with `ENABLE_PLATFORM_PROJECTS` **off**, the default, where the project becomes unrecoverable.
5. Disable-then-count on the local provider (finding 4).
6. An actor holding `manage_instance_users` **without** `instance_admin` — every test currently grants both, so the entire privilege boundary is untested (finding 5). **Run it against both providers**: local and Supabase fail at different points, so a single-provider test proves nothing about the other.
7. Remove member from a public project, assert access retained (finding 13) — currently unasserted in either direction, so a change to `rules.ts:87` would break silently.
8. Private project absence from both `/team` loaders (finding 11).
9. RLS behavior under a real user JWT, not service-role (finding 12).

---

## Spec changes needed

`Permissions.md` is the source of truth and is mostly excellent, but the audit found places where the code is defensible and the **spec** is wrong or silent.

**Read this first — most of these are not spec problems.** Eight amendments to a 772-line document is the expensive way to fix "two write paths into the same table disagree." Before writing any of them, check whether the code change makes the spec sentence unnecessary:

- **§8 + §5 (findings 1 and 2) collapse into one code change.** If the invite mint route and the members PATCH route share the role-gating function their siblings already have, there is nothing left to document — the invariant lives in one place instead of four prose paragraphs.
- **The genuine spec bugs are the self-contradictions**, and those must be fixed regardless of the code: §4:218 (15) says two incompatible things in one sentence; §10's flat "Sessions invalidated" (7) is false; §6 vs the commons branch (20) can't both be true.
- **The genuine spec gaps are decisions only a human can make**: is `private → org` a disclosure action (14)? Do custom org permissions survive a role change (20)?

Sorted that way:

**Fix the code, delete the spec item:**

- **§8** — `/invites` owner-only `orgRole` rule (finding 1).
- **§5** — `checkOwnerRemoval` on any owner-count-reducing transition (finding 2).

**Spec is self-contradictory or false — must be rewritten:**

- **§4:218** — the `autoJoinOnUpload` retroactivity sentence contradicts itself (15). Note also that _"It never changes"_ (:672) about `ownerId` is enforced by convention, not by the type.
- **§10** — "Sessions invalidated" is false as an absolute; state the bounded window, and note it differs per provider (7). **Pass 3 settled the code side, so the spec sentence is now the only thing left.** Logout revokes provider-side; disable cannot, and the route's docstring already carries the accurate per-provider bound — §10 should say the same thing: local and header-auth cut off on the next request, Supabase within one access-token lifetime (`revalidateMs`, default 60s), and in no case does a 30-day refresh token survive, because `refreshSession` rejects disabled users.
- **§6** — draft-channel "owner/editor only" vs the commons owner branch (20).
- **§2** — the last-admin invariant is stated as absolute but is not transactional in either provider (17), and `disabled` admins count as live on local (4).

**Spec is silent — needs a human decision:**

- **§5** — is `private → org` a disclosure action needing leadership (14)?
- **§3** — do custom org permissions survive a role change (20)?
- **§10** — offboarding: what happens to pending invites (8) and share links (9)? Note both need store-interface changes, so the decision has real cost attached.
- **§4a** — may `instance_admin` reclaim a `platform` project? The code says yes via the bypass, §4a:284 says 403 (16).

**Missing from the route matrix entirely:**

- **§8** — `GET /api/v1/orgs/[orgId]/members` isn't listed, and it exposes every member's permission array to any org member.
- **§8** — `GET /api/v1/definitions/{guid}/versions` isn't listed either; new finding 21 shows it disagrees with its own siblings about 403-vs-404.
