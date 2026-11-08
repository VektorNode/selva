# @selvajs/supabase-provider

## 0.21.0-beta.3

### Patch Changes

- 049fa4c: A disabled user can no longer re-enable themselves. `disableUser` bans the user in GoTrue and sets `app_metadata.disabled`, which only the service role writes; every check that read `user_metadata.disabled` (which the user may rewrite through `PUT /auth/v1/user`) reads those two instead. Migration `20261108140000_selva_disabled_is_service_only` points `user_profiles.disabled` at them, moves users disabled the old way over, and installs `selva.refuse_disabled_caller` as PostgREST's `db_pre_request`, so an access token issued before the disable reads and writes nothing until it expires. A host with its own pre-request hook must call `selva.refuse_disabled_caller()` from it.

## 0.21.0-beta.2

### Patch Changes

- d424587: The Supabase storage provider refuses a path with a `..` segment with a 400 on `get`, `put`, `delete` and `deletePrefix`, as the local provider does. Before, a read of such a path came back as not found. The storage conformance suite checks every method for this under `pathContainment`.
- d424587: Deleting a user on Supabase removes the invites addressed to them, and redacts their address from `invite.created` audit payloads, whatever case the address arrives in. Before, an address whose case differed from the stored, lowercased one left those rows behind. The local provider already matched case-insensitively; it no longer emits an `org_member.removed` event for each org it erases the user from.

  Conformance kit: `runUserErasureConformance` checks what `IDataProvider.onUserDeleted` removes (invites to and from the user, their API tokens, memberships and profile) and what it keeps (the orgs and projects they owned, under `ERASED_ACTOR_ID`). `runProjectStoreConformance` takes `orgScoping`, with `otherOrgId` from `createStore`, to check that slug lookups and listings stay inside the org asked for.

- Updated dependencies [d424587]
- Updated dependencies [d424587]
  - @selvajs/platform@1.1.0-beta.2

## 0.21.0-beta.1

### Patch Changes

- 02f41e4: An invite whose permissions or membership could not be applied after it was claimed is handed back, so the invitee can open the link again instead of needing a new invite. `IInviteStore` gains an optional `reopen`, implemented by the local and Supabase stores; the conformance suite tests it under the `reopen` option.
- Updated dependencies [02f41e4]
- Updated dependencies [8602332]
  - @selvajs/platform@1.1.0-beta.1

## 0.21.0-beta.0

### Minor Changes

- b38182e: Store fixes across both providers:

  - `markAccepted` refuses an expired invite.
  - A share link stops counting solves once its definition is deleted. On Supabase this is a new migration: run `npx selva-supabase` and `supabase db push`.
  - Supabase emits `definition.deleted` only when a row was deleted, and `listUsers` and the audit query clamp their limit (`limit: 0` returns one row; the audit default is now 50).
  - Local's `revoke` of an unknown share link is a 404, and local storage refuses a bad path with `ProviderError` 400.
  - Supabase has no platform-project grants, so provider setup now fails when `ENABLE_PLATFORM_PROJECTS` is on. `IPlatformProjectGrantStore` gains an optional `unsupported` marker.

### Patch Changes

- b38182e: Compute API keys are sealed in a new `enc:v3:` envelope that binds both the server id and its URL, so a row whose `serverUrl` is edited at rest no longer decrypts and sends its key to the new host. Both compute-server stores seal and re-seal on save, `reencryptSecrets` moves `enc:v1:`/`enc:v2:` rows to v3, and `verifySecrets` reports them in `legacyEnvelopes`. v1 and v2 still decrypt. Decryption also pins a 16-byte GCM tag. `encryptSecret`, `decryptSecret` and `decryptWithKeys` accept a `{ id, url }` binding alongside the old string; new exports on `./computeServer`: `readAtRestKeys`, `parseKey32`, `isLegacyEnvelope`, `SecretBinding`.
- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
  - @selvajs/platform@1.1.0-beta.0

## 0.20.0

### Minor Changes

- edb568d: API tokens, row-level security that holds on its own, and transactional compute saves. Run `npx selva-supabase`, then `npx supabase db push`, before updating the app.

  **Action needed**

  - Closed `selva` functions anonymous and signed-in callers could reach through PostgREST (`set_platform_permissions`, `claim_first_instance_admin`, `redact_audit_event_email`, `migration_head`, `try_increment_share_link_solve_count`, trigger functions); they answer only to the service role. The migration doesn't undo earlier abuse: check `selva.user_profiles.platform_permissions` on live deployments.
  - Sessions can no longer select `compute_servers.api_key`, and can only set `accepted_at` / `accepted_by_user_id` on `selva.invites`. Host apps doing either with a session JWT must move behind the service role.

  **Added**

  - `SupabaseApiTokenStore` and the `api_tokens` migration; `audit_events.token_id`; `definitions.source_document_id`.
  - Delegated sessions: `SupabaseAuthProvider` signs ES256 with `SUPABASE_JWT_SIGNING_KEY` or HS256 with `SUPABASE_JWT_SECRET`, with a configurable lifetime (`delegatedSessionTtlSeconds`). A key's session carries `selva_org`, so `selva.is_instance_admin()` is false under a key.
  - `save_platform_compute_servers` / `save_org_compute_servers`, `remove_org_member` and `org_share_link_roster` RPCs. `supabaseUpstream` for request timing. `/config` env slice.

  **Fixed**

  - RLS enforces the access rules directly: invites, `org_members` role changes, commons projects and `user_profiles` reads follow the same rules as the app.
  - Erasing a user nulls `owner_id` / `uploaded_by` instead of deleting shared orgs, projects and versions.
  - Compute saves run in one transaction and keep unchanged servers' defaults. Two admins demoting each other no longer deadlock. Saving a definition with no tags no longer fails. Storage listing pages past 1000 entries.

### Patch Changes

- 90d0073: Trailing `/` and `=` are stripped from config values with a loop instead of a regex, which backtracked quadratically on a long run of either character.
- Updated dependencies [90d0073]
- Updated dependencies [edb568d]
  - @selvajs/platform@1.0.0

## 0.20.0-beta.9

### Minor Changes

- a723f1a: Telemetry seams a host wires once: error reports that group and scrub, request and upstream timing, and MCP tool-call records.

  - `@selvajs/platform`: `ErrorContext` takes `level` (`fatal`, `error`, `warning`) and `kind`, which groups reports of one fault whose message varies.
  - `@selvajs/server/errors`: `scrubEvent`, `scrubBreadcrumb`, `withoutQuery` and `sampleRate` keep cookies, auth headers, bodies, query strings and anything but a user's id out of Sentry-shaped events, server or browser, without importing Sentry. `SentryErrorReporter.create` installs them and takes `tracesSampleRate`. `SentryErrorReporter.fromClient` wraps an SDK the host initialized itself, such as a framework SDK that also traces requests. `capture` sends `level`, tags `kind`, and fingerprints by it.
  - `@selvajs/server/http`: `createRequestTiming` times a request's spans and every outbound fetch by upstream, stamps `Server-Timing`, and logs a `[timing]` record for a slow, sampled (`sampleRate`, default 0.1) or first request, with each upstream's call count, total, median and max. The first request also logs `[coldstart]` with the boot time `markBooted` recorded. Every record carries a per-process `instance` and the host's `labels`.
  - `@selvajs/supabase-provider`: `supabaseUpstream` names a Supabase call's service (`db`, `auth`, `storage`) and table or RPC for `createRequestTiming`.
  - `@selvajs/server/api`: an endpoint with `longRunning` (it runs Compute without the `solve` scope) is emitted with `x-long-running`.
  - `@selvajs/mcp`: an `x-long-running` operation gets `solveTimeoutMs`, not the default timeout. `ApiClientOptions.onCall` is told of each settled call (operation, status, error code, attempts, duration). `McpServerOptions.onToolCall` is told of each tool call: outcome (`ok`, `error`, `timeout`, `invalid_arguments`), the API calls it made, argument names with their sizes, never values, and the response size.
  - `@selvajs/selva`: requests are timed through `createRequestTiming`, MCP tool calls log an `[mcp]` record, and `SENTRY_TRACES_SAMPLE_RATE` sets Sentry's trace sampling. Sentry events are scrubbed before they leave.

### Patch Changes

- Updated dependencies [a723f1a]
  - @selvajs/platform@1.0.0-beta.11

## 0.20.0-beta.8

### Minor Changes

- 95dbab4: Fewer sequential round trips per request, and helpers so a host gets them too.

  - `@selvajs/platform`: `IDefinitionStore.getDefinitionsFor` reads several definitions in one query, and `listVersionsFor` reads every version of several definitions in one query, newest first and without the schema. A page listing many definitions no longer issues one `get` or `listVersions` per definition. Both providers implement them, and the conformance suite covers them.
  - `@selvajs/server/http`: `createSessionResolver` turns a session token into a host's session. It reads the user's rows while the token is checked, shares one resolution between requests carrying the same token, and with `freshForMs` reuses a session, re-checking it behind the request once the window has passed. A session is never answered past its token's expiry. `createRequestMemo` shares repeated reads within one GET or HEAD request.
  - `@selvajs/server/http`: `resolveApiToken` takes a `resolutionCache` (`createApiTokenResolutionCache`, 60 seconds by default). A key seen within the window is answered without reading it or its owner again, and its delegated session is still minted fresh. Pass the same cache as `SelvaDeps.tokens.resolutionCache`: the revoke handlers, a member's removal and `revokeUserApiTokens` then drop the key from it at once. Another instance stops accepting a revoked key within the window.
  - `@selvajs/server/compute`: `createServerResolver` remembers each caller's resolved compute server for 30 seconds. `SelvaDeps.onComputeConfigSaved` runs after the org compute handler saves, so a host clears it there.
  - `@selvajs/selva`: a solve reads its definition's version and resolves its compute server while access is checked. The team, members, user-admin and token pages read in parallel. The solve page reads the org logo beside the definition. The session hook reads a JWT session's rows beside its check and shares one resolution between concurrent requests. API keys and compute server choices use the caches above. The hook no longer loads the MCP server at boot.

### Patch Changes

- Updated dependencies [95dbab4]
  - @selvajs/platform@1.0.0-beta.10

## 0.20.0-beta.7

### Patch Changes

- a85ad5c: Fewer sequential round trips on two hot paths.

  - `createDefinitionLoader` resolves the definition's compute server while it reads the version and the definition file, instead of after them. A describe that misses the cache waits on two fewer round trips. A definition missing its version or file still fails as `data` before a missing server fails as `missing-config`.
  - `SupabaseAuthProvider.verifyToken` in `hybrid` mode checks a symmetric (HS256) token with one GoTrue `getUser`. `getClaims` cannot verify such a token locally and asks GoTrue itself, so the periodic recheck made it two calls.

## 0.20.0-beta.6

### Minor Changes

- 94692f5: Deployment config you can see, change safely and rotate without breaking anything.

  - **Every env var is declared once**, with its type, default, what changing it affects and whether a bad value stops boot (`@selvajs/platform/config`, plus a slice per package: `@selvajs/server/config`, `@selvajs/*-provider/config`). A host app composes the slices it ships and calls `resolveConfig` or `buildConfigReport`.
  - **`selva config show`** lists what `.env` sets, what is default, what is wrong, keys Selva doesn't read (with the likely intended name), and what differs from what the app last booted with. **`selva config set KEY=VALUE`** checks the value and edits only that line, with a backup. `/admin/system` shows the same report to instance admins, read-only.
  - **A bad value on a security control now stops boot** instead of silently falling back. `SUPABASE_ALLOW_EMAIL_LINK_SIGNUP` used to read anything but the exact string `false` as on, so `=no` allowed sign-ups; booleans now accept `true|false|1|0|yes|no|on|off` and nothing else.
  - **Key rotation keeps the old key working.** `selva keys rotate hmac` (or `at-rest`) moves the old key to `SELVA_HMAC_KEY_PREVIOUS` / `SELVA_AT_REST_KEY_PREVIOUS`, which sessions, OAuth/MCP clients, solve-event tokens and stored compute API keys still accept. Boot re-seals API keys under the new at-rest key. The previous key is accepted for 30 days (`<KEY>_PREVIOUS_EXPIRES`), then refused on its own; `/admin/system` and `selva doctor` count down to it. `--finish` ends the overlap early, `--leaked` drops the old key at once.
  - **Share links expire after 90 days by default.** A link minted without `expiresAt` gets one; an explicit `expiresAt: null` still means never. The mint dialog has expiry on by default.
  - **Share-link, invite and API tokens are stored as an unkeyed SHA-256.** New tokens no longer depend on `SELVA_HMAC_KEY`; tokens stored before keep resolving under the current or previous key. `createTokenCodec` takes `previousSecret`, and `findByToken` looks a token up by every hash form its record may carry.
  - **`selva migrate --dry-run`** shows the `.env` rewrite (renamed keys, values a looser reader used to accept, no-op lines, shipped template prose) and proves every setting keeps its meaning before writing. `--undo` restores the backup.
  - **The CLI no longer corrupts `.env` when it rewrites it.** A JSON value such as `SUPABASE_JWT_SIGNING_KEY` came back as `{\`, and an inline comment ended up inside the value. Rewrites now edit single lines, read back with Node's own parser, and write `.env` and its backups as `0600`.
  - **An `http://` `ORIGIN` drops the `Secure` cookie flag**, so sign-in over plain HTTP works without `ALLOW_INSECURE_COOKIES`, which still overrides either way.
  - `selva doctor` accepts a 32-byte base64 key, as the runtime does.

### Patch Changes

- Updated dependencies [94692f5]
  - @selvajs/platform@1.0.0-beta.9

## 0.20.0-beta.5

### Minor Changes

- 817af19: Stored compute ciphertext can no longer be replayed to decrypt someone else's API key.

  - `encryptSecret` and `decryptSecret` take an optional `aad`. With it, `encryptSecret` writes an `enc:v2:` envelope bound to that value. `enc:v1:` envelopes still read, and a store rewrites them as `v2` the next time their server is saved.
  - Both compute stores bind each key to its server id and refuse a value that's already an envelope, instead of passing it through.
  - `validateIncomingServers` rejects an `apiKey` that looks like an envelope, on both the admin and org compute routes.
  - On Supabase, sessions can no longer select `compute_servers.api_key`. The store reads keys with the service role, and only for servers the session's own read can see.

  Apply this release's migration: run `npx selva-supabase`, then `npx supabase db push`. Host apps that select `api_key` with a session JWT have to move that read behind the service role.

- 6efcd98: Erasing a user no longer takes shared data with them, and a compute save can no longer lose servers, keys or defaults.

  Erasure on Supabase: `owner_id` on orgs, projects and definitions and `uploaded_by` on versions now go null when the user is deleted, and the stores read that as the erased actor. An org, or a project someone else works in, used to be deleted along with its creator, and the uploader of someone else's live version couldn't be erased at all. `DELETE /api/admin/users/[id]` now answers 409 for the only owner of an org: make someone else an owner, or delete the org, first.

  Compute saves:

  - On Supabase, `savePlatformServers` and `saveOrgServers` run in one transaction, through the new `save_platform_compute_servers` and `save_org_compute_servers` RPCs. A failed save leaves the stored set alone, and an unchanged server keeps its org defaults.
  - `validateIncomingServers` refuses a server id that isn't a UUID, a repeated id, a `timeoutMs` outside 1000 to 300000 and a `retryCount` outside 0 to 5. An id already used by another org or the platform answers 409 on Supabase.
  - A save that leaves `apiKey` out for a key that can't be decrypted answers 409 instead of overwriting the ciphertext. Restore `SELVA_AT_REST_KEY`, or send a new key.

  Apply this release's migrations: run `npx selva-supabase`, then `npx supabase db push`. Local deployments with a hand-written, non-UUID server id have to give it a UUID before they can save compute config.

- 5ab63df: A clean-up major for the platform contract. Adapters and direct consumers need the changes below. No behaviour changes for an app that only uses the routes.

  Changed signatures:

  - `IStorageProvider.put` returns the path it stored at, since images are rewritten to `.webp`. An adapter has to return it; a caller can use it instead of guessing.
  - `IInviteStore.markAccepted` returns `true` when this call accepted the invite and `false` when it was already accepted or is gone.

  Removed:

  - `IOAuthAuth.refreshSession`. Use `auth.sessionRefresh?.refreshSession(...)`.
  - `orgPaths.privateAsset`, `requireCanViewOrg` from `@selvajs/server`, and the `org` value of `AssetVisibility` and `AssetScope`. No asset class serves those paths.
  - `orgServersFor`, `isPublicAssetPath`, `COVER_IMAGE_EXTENSIONS`, `ALLOWED_UPLOAD_EXTENSIONS`, `DefinitionVersionSchema` and `DefinitionFileExtSchema`, which nothing used.

  No longer exported, though still used inside the package: `ApiTokenRevokeReasonSchema`, `IMAGE_MAX_WIDTH`, `IMAGE_WEBP_QUALITY`, `isImageUpload`, `toWebpPath`, `AssetVisibility`, `AssetScope`, `AssetClass`, `AssetMatch`, `ALL_ORG_ASSET_KINDS`, `CreateOrgInput`, `UpdateOrgInput`, `DefinitionChannelSchema`, `UUID_REGEX`, `PlatformProjectGrantSchema`, `PlatformProjectGranteeTypeSchema`, `PlatformProjectGranteeType`, `AuditUpdate` and `AuditSoftDelete`.

  The root barrel now re-exports each area with `export *`, so a new export reaches it without a second edit. Secret crypto stays out of it, on `@selvajs/platform/computeServer`. `OPERATOR_PLATFORM_PERMISSIONS` is also on `@selvajs/platform/permissions`.

- 1fb3914: Row-level security now enforces the access rules on its own, so a user holding a session JWT can't get around them by calling PostgREST directly.

  - Pending invites can't be edited apart from being accepted, and minting one is held to `canChangeOrgRole` and the instance-admin rule for platform permissions.
  - `org_members` writes follow `canChangeOrgRole`: an admin can no longer promote themselves or change an owner.
  - A departed member can't reactivate a project owner row or edit, share or revoke on a commons project. An outsider can still finish a first upload to a public commons.
  - `user_profiles` reads are limited to yourself and people who share an org with you.
  - API-token sessions stay inside their token's org on every membership check.

  Removing an org member now ends their access to private projects the acting admin can't see, through the new `remove_org_member` RPC. Reclaim reaches those projects too, and the orphaned-project report includes them.

  The share-link roster now lists links on private projects, through the new `org_share_link_roster` RPC. Commons uploaders can revoke their own links, and `revoke` fails with a 403 or 404 instead of reporting success when RLS filtered the write. `revokeUserApiTokens` runs as `system`, so an operator without a grant on the org no longer leaves a disabled user's tokens live.

  `removeOrgMember` throws a 404 for someone who isn't a member, on both providers. Conformance suites in `@selvajs/platform` assert this, so a third-party adapter has to do the same.

  Apply this release's migration: run `npx selva-supabase`, then `npx supabase db push`. Host apps that wrote to `selva.invites` with a session JWT can now only set `accepted_at` and `accepted_by_user_id`.

### Patch Changes

- cc081b1: Two admins demoting each other on Supabase no longer deadlock. One now gets `last_admin` rather than a 500. Apply this release's migration: run `npx selva-supabase`, then `npx supabase db push`.

  New in `@selvajs/platform`, none of it breaking:

  - `COMPUTE_TIMEOUT_DEFAULT_MS`, `COMPUTE_TIMEOUT_MIN_MS`, `COMPUTE_TIMEOUT_MAX_MS` and `COMPUTE_RETRY_MAX`, plus `clampTimeoutMs` and `clampRetryCount`, so the settings forms and the server agree on one set of limits.
  - `pickServer`, for a caller that holds an already-filtered server list.
  - `decodeOffsetCursor`, `encodeOffsetCursor` and `clampPageLimit`, which both providers now use. A `NaN` limit reads as the default.
  - `assertCanAccessProfile` and `MAX_RECENT_RUNS` from `@selvajs/platform/userProfile`, for adapter authors.
  - `runOAuthAuthConformance` and `runAuditQueryConformance` in `@selvajs/platform/testing`.
  - `defineConfig` keeps the type you pass it.

- 35e5c67: Interface docs now match what providers do, and the conformance suites test more of it.

  - Contract docs cover `hasInstanceAdmin` and disabled users, plaintext keys at rest, `saveOrgServers` ignoring non-org entries (local now does what Supabase does), share-link reads and `revoke`, default list order, `rate_limited`, the delegated-session lifetime and the delete order.
  - `DefinitionChannel` and `PlatformProjectGranteeType` derive from their schemas.
  - `SupabaseAuditQuery` treats a fractional limit below 1 as 1.
  - Saving a definition cover gives it a new URL, so caches don't keep the old one.
  - The tarball no longer ships source maps that point at sources it doesn't include.
  - `@selvajs/platform/permissions` exports `assertCanReadPermissions`, `assertCanReadPermissionsBatch` and `assertCanManagePermissions` for adapter authors, and both bundled permission stores use them.

  Conformance changes for adapter authors:

  - `runAuthCoreConformance` and `runPasswordAuthConformance` are new, and `runAuthProviderConformance` wraps them. Pass `passwordless` to run the core alone, and `selfRegistration` to test `registerUser`.
  - `listByOrg` cases run only with `orgRoster: true`, and show as skipped otherwise instead of passing with no assertion.
  - `runOrgStoreConformance` and `runProjectStoreConformance` take `seedOutsider`, and the definition scope takes `privateProjectId`, for the ctx-isolation cases.
  - `runEmailLinkAuthConformance` no longer takes `validEmail`, and `sendMagicLink` on an invalid address must answer `invalid_email`.
  - `removeOrgMember` on a non-member, `saveOrgServers` with a non-org entry, `markAccepted` keeping its first acceptor, and `tryIncrementSolveCount` under concurrency are now tested, along with compute key reads and `recordRun`. `delete` on an unknown grant id is no longer pinned to throw.

- 77780c7: Smaller fixes across the platform package and its consumers.

  - The solve-metric cap now counts batches waiting to be written, so a hung backend can't grow memory past `maxBufferSize`, and dropped rows are logged.
  - `@selvajs/platform` declares `sideEffects: false` and no longer names `sharp` statically, so the root barrel bundles for the browser. `instanceof ProviderError` works across two installed copies.
  - SMTP failures log an error code and a keyed hash of the recipient instead of the address and the raw server message, and `SendResult.reason` carries the code.
  - `scopeConfigToOrg` drops an org default the org can't see.
  - `decodeSecretKey` trims whitespace and refuses junk-padded input or a passphrase that isn't really base64.
  - `slugify` folds accents and never ends in a hyphen. A renamed project with no usable letters keeps its slug. New `orgSlugFromName` moves an org off a reserved word, and setup and bootstrap use it.
  - `RESERVED_SLUGS` now matches the route tree: `docs`, `mcp` and `oauth` are in, `settings` is out, and a test holds it there.
  - Org and definition names are trimmed, so a name of only spaces is refused.
  - `withCacheBust` puts the token before a fragment.
  - Session refresh uses `auth.sessionRefresh` first, so a provider without OAuth is refreshed too.
  - `canEdit`, `canManage` and `canEditProjectSettings` refuse a null project, `canEditDefinition` checks the definition belongs to the project, and `canView` on an `org` project requires acting as that org.

- ff7e2a0: Image uploads have limits, stored images match the docs, and deleted orgs and projects take their blobs with them.

  - `transcodeImageIfNeeded` refuses more than 60 MP, stops after 10 seconds, runs two at a time and checks the real format, so a small upload can no longer eat gigabytes or seconds of CPU. SVG has to be declared as SVG. Anything it won't process throws `ProviderError(422)` rather than a 500.
  - Stored images apply EXIF orientation and fit within 1200px on both sides, not only the width.
  - A declared content type now beats the file extension: a PDF named `x.png` is stored as a PDF.
  - `IStorageProvider.put`'s doc now states that images are stored as WebP at a rewritten path, as part of the contract.
  - `deletePrefix` refuses an empty prefix and `/` on both providers, and the Supabase listing pages past 1000 entries.
  - `SupabaseStorageProvider` keeps any unclassified path in the private bucket.
  - `GuidSchema` lowercases, so one GUID can't become two records on local.
  - The `definition-cover` class matches `cover.webp` only, and the unused `org-private` class is gone, along with its branch in `/api/files`. `orgPaths.privateAsset` is deprecated.
  - `deleteProjectWithBlobs` and `deleteOrgWithBlobs` in `@selvajs/server/projects` wipe blobs on delete, and every delete route uses them.

- 68d554c: Saving a definition with no tags no longer fails on Supabase. The edit drawer sends `tags: null`, which hit the `not null` column and returned a 500. The store now writes an empty array.
- adb9cc3: Close `selva` functions that anonymous and signed-in callers could reach through PostgREST with the anon key. That let anyone change platform permissions, claim instance admin, rewrite audit rows and spend share-link quota. These functions now answer only to the service role: `set_platform_permissions`, `claim_first_instance_admin`, `redact_audit_event_email`, `migration_head`, `try_increment_share_link_solve_count` and the trigger functions. `increment_run_count` and `reserve_next_version_number` no longer accept anon.

  Apply this release's migration: run `npx selva-supabase`, then `npx supabase db push`. Host apps calling any of these from a browser session have to move the call behind the service role. The migration doesn't undo earlier abuse, so check `selva.user_profiles.platform_permissions` on live deployments.

- Updated dependencies [b6935ce]
- Updated dependencies [817af19]
- Updated dependencies [cc081b1]
- Updated dependencies [eebd2f6]
- Updated dependencies [35e5c67]
- Updated dependencies [77780c7]
- Updated dependencies [5ab63df]
- Updated dependencies [ff7e2a0]
- Updated dependencies [1fb3914]
  - @selvajs/platform@1.0.0-beta.4

## 0.20.0-beta.4

### Patch Changes

- e39d929: chore(deps): bump the npm group across 1 directory with 34 updates

## 0.20.0-beta.3

### Minor Changes

- 493612c: Upload-only API tokens and the Grasshopper plugin's sign-in.

  - A key whose scopes only read and upload may be held by anyone who can create a definition in one project of the token's org; anything broader still needs `manage_api_tokens`. Checked at mint and on every request.
  - **Breaking:** `ApiTokenHolderPolicy` is `(ctx, scopes) => boolean | Promise<boolean>`, and `canHoldApiTokens(ctx, scopes, { policy, deps })` is async. `ResolveApiTokenDeps.data` also needs `projects`, `platformProjectGrants` and `definitions`, plus an optional `flag`.
  - OAuth knows a built-in client, `selva-grasshopper`, which redirects only to `http://127.0.0.1/callback` on any port and is the only client that may be granted the new `upload` scope. Registered clients asking for it get read and solve at most. `consentChoices`, `consentOrgs` and `mintConsentToken` let a consent page mint in an org the user picks, through `mintApiToken`, the same core as the token endpoint.
  - `revokeOwnApiToken` lets a key revoke itself; `runHandler`'s `anyScope` opens a route to every key.
  - `GET /projects` items gain `canCreateDefinitions`, `GET /definitions/{guid}` gains `canEdit` and `sourceDocumentId`, list items gain `sourceDocumentId`, and `GET /definitions?documentId=` finds the definitions from one Grasshopper document the caller can upload to. `/me` reports the key's `expiresAt`.
  - Supabase: migration `20261021120000_selva_definition_source_document` adds `definitions.source_document_id`.

### Patch Changes

- Updated dependencies [65786d5]
  - @selvajs/platform@0.21.0-beta.3

## 0.20.0-beta.2

### Minor Changes

- ef94b55: API tokens stay inside what they were minted for:

  - **Breaking:** `resolveApiToken` re-checks on every request that the owner may still hold keys. Without a host `mayHoldApiTokens` policy that means `manage_api_tokens`, so withdrawing the permission turns existing keys off (403 `API_TOKEN_HOLDER_REFUSED`). `ResolveApiTokenDeps.data` now needs `permissions`. `canHoldApiTokens(ctx, policy?)` in `@selvajs/server/tokens` is the one place that default lives.
  - Moving a definition with `PATCH /definitions/{guid}` needs `write` on the destination project too, so a project-scoped key can't carry a definition out of its project.
  - A scope refusal on a definition outside the key's org reads exactly like one on a missing guid: the 403 detail no longer confirms it exists or names its project.
  - Supabase: a new migration stops an owner from writing `revoked_at = null` to revive a revoked key. Run `selva-supabase` to sync it.
  - Supabase: the delegated session's lifetime is configurable (`delegatedSessionTtlSeconds` on `SupabaseAuthProvider`, or the third argument of `fromEnv`), so a long solve doesn't end with an expired JWT.
  - Local provider: token writes are serialized, so a `lastUsedAt` write racing a revoke can no longer restore the key, and concurrent mints no longer lose one.
  - `listOrgApiTokens` and `canManageApiTokenRoster` in `@selvajs/server/handlers` back both the list endpoint and a host's token page.
  - **Breaking:** `read_all_org_projects` is removed. Nothing enforced it yet.
  - **Breaking:** `requestFingerprint` takes the request `URL` instead of a path string, so every caller hashes the query too. `idempotencyKey`, `toStoredResponse`, `fromStoredResponse`, `IDEMPOTENCY_REPLAYED_HEADER` and `StoredResponse` are no longer exported from `@selvajs/server/compute`.

### Patch Changes

- Updated dependencies [ef94b55]
  - @selvajs/platform@0.21.0-beta.2

## 0.20.0-beta.1

### Minor Changes

- b36ac7d: API tokens stay inside their org and their owner's membership.

  - **A token only reaches its own org.** A key's owner may belong to other orgs; the key no longer lists, reads, solves or edits anything there. Other orgs' projects and definitions answer 404. `@selvajs/platform` exports `outsideTokenOrg(ctx, orgId)` for host routes.
  - **No instance-admin rights under a key on Supabase.** Delegated sessions carry a `selva_org` claim, and `selva.is_instance_admin()` returns false for them, so an admin's key no longer passes the policies' admin bypass into other orgs. `selva.delegated_org()` exposes the claim to host policies. `IDelegatedSession.mint` now takes `{ orgId }`. **Run `npx selva-supabase` and `npx supabase db push` before updating the app.**
  - **Keys follow membership.** Removing a member revokes their keys in that org and disabling a user revokes all of theirs, so re-adding them doesn't revive old keys. `revokeUserApiTokens` is exported from `@selvajs/server/handlers` for host routes.
  - **Moving a definition needs edit rights on the destination.** `PATCH /definitions/{guid}` with a new `projectId` used to check only the source project.
  - The new-key email links to `SelvaDeps.apiTokenSettingsPath` (default `/settings/tokens`) instead of a hardcoded `/admin/tokens`.

### Patch Changes

- Updated dependencies [b36ac7d]
  - @selvajs/platform@0.21.0-beta.1

## 0.20.0-beta.0

### Minor Changes

- 5a96097: API tokens on the Supabase provider.

  - `@selvajs/platform`: `IAuthProvider.delegatedSession` (`IDelegatedSession`): signs a short-lived session for a user so a token request runs under their row security.
  - `@selvajs/server`: `resolveApiToken` signs that session for the owner after re-checking them and puts it in `ctx.adapterContext.sessionToken`. While the provider reports the key broken, every key gets 503 `API_TOKENS_UNAVAILABLE` and `createApiToken` refuses to mint.
  - `@selvajs/supabase-provider`: `SupabaseApiTokenStore` and the `api_tokens` migration (RLS: own keys, the org roster for `manage_org_members`; sessions can only set `revoked_at` and never read the hash), plus `audit_events.token_id`. `SupabaseAuthProvider` signs ES256 with `SUPABASE_JWT_SIGNING_KEY` or HS256 with the legacy `SUPABASE_JWT_SECRET`, and checks once that PostgREST accepts the key. **Run `npx selva-supabase` and `npx supabase db push` before updating the app.**
  - `@selvajs/selva`: the admin health page reports whether API token sessions work; `.env.example` documents both keys.

### Patch Changes

- d50c8fa: API tokens, resolution and enforcement (no minting UI yet).

  - `@selvajs/platform`: `ApiToken`, `IApiTokenStore` (optional `apiTokens` on `IDataProvider`), `scopeAllows`, `narrowApiTokenContext`, `apiScope` on `RequestContext`, the `manage_api_tokens` and `read_all_org_projects` permissions, `api_token.*` events, and `actorOf`, which adds `tokenId` to events written during a token request. `read_all_org_projects` is not in the owner/admin defaults.
  - `@selvajs/server`: `resolveApiToken` and `buildRequestContext` in `/http`; `createApiTokenCodec` (`selva_` keys with a checksum) in `/tokens`; `runHandler` checks API-token scopes, with `action` and `scopeTarget` options; `ApiError` gains `details`; new code `API_TOKENS_UNAVAILABLE`.
  - `@selvajs/local-provider`: `LocalApiTokenStore`, wired into the org-delete cascade and user erasure.
  - `@selvajs/selva`: the hook resolves `Authorization: Bearer selva_…` on `/api/v1/*` before the cookie, and a bad key never falls back to the session.

- Updated dependencies [d50c8fa]
- Updated dependencies [5a96097]
- Updated dependencies [5a96097]
  - @selvajs/platform@0.21.0-beta.0

## 0.19.7

### Patch Changes

- 7f0da02: Republish of the previous release. npm staged that release instead of publishing it and then dropped it, so those versions were never installable and npm won't accept them again. No code changes.

## 0.19.6

### Patch Changes

- 251d17b: chore(deps): bump the npm group with 18 updates
- 0d3a9c3: Make `20260425155514_selva_initial.sql` replay-safe.

  The migration issued 41 `create policy`, 5 `create trigger` and 2
  `add constraint` statements unguarded, so it aborted with SQLSTATE 42710 on any
  database that already held those objects. Each is now preceded by its
  `drop ... if exists`, matching the pattern the file already used for
  `trg_auth_user_created` and the `selva-public` storage policy. No statement was
  removed or reordered — the guards are pure additions.

  This matters to a consuming app that squashes its own history into a baseline
  dumped from a live database: that dump necessarily contains every `selva` object
  this migration creates, and on a fresh database the two run in sequence. The
  Supabase CLI selects the whole migration batch _before_ executing any of it, so
  recording these timestamps as already-applied from inside the baseline cannot
  prevent them running — the stamp lands too late. Making the migration idempotent
  is what actually resolves it.

## 0.19.5

### Patch Changes

- cf41e54: chore(deps): bump the npm group across 1 directory with 26 updates

## 0.19.4

### Patch Changes

- 87f2c6a: chore(deps): bump the npm group across 1 directory with 24 updates

## 0.19.3

### Patch Changes

- Updated dependencies [4d16b79]
  - @selvajs/platform@0.20.0

## 0.19.2

### Patch Changes

- 1c5ff24: Fix the migration-sync command that every error message told operators to run.

  The bin is `selva-supabase`, and the script is the whole command — it takes no subcommand. But its own `--help` output, and the header comment above it, both printed `npx @selvajs/supabase-provider sync-migrations`, which the same file's argument parser rejects with `unknown argument: sync-migrations`. Anyone who ran `--help` instead of finding the operator docs got a command that cannot work.

  `SupabaseDataProvider.verifySchemaVersion` embedded the same broken form in the message it surfaces through `/api/health`, so it reached operators at the exact moment they were stuck.

  `doctor`'s three migration-head failures said "Sync + run: npx supabase db push" without ever naming the sync step, leaving the reader to guess half the fix. They now give both commands.

  The scaffold's next-steps block told a first-time operator to run `supabase link` but never `supabase login`. `link` needs a Supabase _account_ credential, which is none of the three project keys the prompts just collected — the most common first-run stall. It now names the login step and says why the `.env` keys don't cover it.

  Also fixes a dead anchor in the provider README pointing at a heading that does not exist.

- 6fa6b27: Three small fixes found in the open-issue backlog.

  The solve client serialized the input values a second time on every solve just to print their size. `JSON.stringify(values).length` ran unconditionally while the log line it fed was behind the `debug` flag, so a potentially MB-scale tree was walked and thrown away on every request in production. The measurement moved inside the `debug` block.

  Dialogs cap at `max-h-[85dvh]` and scroll internally. The content primitive set no height bound, so a dialog with a long member list or many form fields grew past the viewport instead of scrolling — the top and bottom, including the confirm button, became unreachable.

  Two index gaps in the Supabase schema. Definition lists sort on `created_at` under a `project_id` filter with only a `project_id` index behind them, so each project page sorted its slice in memory; a composite `(project_id, created_at desc)` covers both. And `SupabaseAuditQuery` paginates keyset-style on `(occurred_at desc, id desc)` while the three audit indexes stopped at `occurred_at`, leaving the tie-breaker to a sort — each is replaced by one carrying `id`.

- Updated dependencies [6fa6b27]
  - @selvajs/platform@0.19.1

## 0.19.1

### Patch Changes

- e782803: chore(deps): bump the npm group across 1 directory with 12 updates

## 0.19.0

### Minor Changes

- e779034: Make the first-admin bootstrap atomic, so "first signer wins" is true under concurrency.

  `bootstrapUserSession` asked `hasInstanceAdmin()` and then called `set()` — two
  round-trips with nothing holding the gap. On a single-tenant install with no
  `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` configured, `shouldBootstrapAdmin` returns true
  for _any_ signer, so two different people signing in at the same moment both
  observed "no admin yet" and both were granted every platform permission,
  permanently. Permissions.md §2 promises the first signer wins; it was aspiration.

  `IPlatformPermissionStore` gains `claimFirstInstanceAdmin(ctx, userId,
permissions)`, which grants only if no enabled `instance_admin` exists and
  returns whether this call was the one that claimed it. It is the mirror of the
  sole-admin invariant already enforced in `set`: that one refuses to drop the
  _last_ admin, this one refuses to create a _second first_ admin.

  Supabase implements it as a `SECURITY DEFINER` RPC
  (`selva.claim_first_instance_admin`) taking a transaction-scoped advisory lock,
  then re-reading inside it. There is no row to lock — the whole point is that no
  admin row exists yet — so the `for update` approach used for the last-admin
  invariant does not apply here, and a bare `not exists` in the `UPDATE` predicate
  would not work either: under READ COMMITTED both racers read the snapshot taken
  when their statement began and both see an empty set. A caller that blocks on
  the advisory lock re-reads after the winner commits and correctly loses.

  Local shares the existing promise-chain mutex with `updatePermissionsGuarded`,
  deliberately: the two decide the same question from opposite ends, so they must
  not interleave with each other any more than with themselves.

  `platformPermissionStoreSuite` gains two cases — a sequential claim-then-refuse,
  and a four-way concurrent burst asserting exactly one admin results. Both
  adapters are pinned to the same contract.

  Supabase deployments need the new migration
  (`20260817200000_atomic_first_admin_claim.sql`); `EXPECTED_MIGRATION_HEAD` moves
  with it, so a stale database fails the startup check rather than silently
  running the old path.

- e779034: Make the sole-`instance_admin` invariant atomic in both providers.

  `set` checked the surviving-admin count and wrote in two steps with nothing
  holding the gap. Two admins demoting each other at the same moment each observed
  the other as "another admin exists", both passed, and both committed — leaving
  zero instance admins and an instance that can no longer be administered through
  the UI. Permissions.md §2 states the invariant as absolute; it was not.

  Supabase moves the check inside a `SECURITY DEFINER` RPC
  (`selva.set_platform_permissions`) that locks the target row and then the
  surviving admin rows with `for update`, so concurrent demotions serialize
  instead of racing. A bare `exists` in the `UPDATE` predicate is not sufficient
  under READ COMMITTED — the subquery reads the statement's snapshot — and the
  conformance suite fails without the explicit locks.

  Local serializes guarded permission writes through a promise-chain mutex and
  counts inside the critical section, matching the single-process boundary its
  load-once cache already assumes.

  `platformPermissionStoreSuite` gains two concurrency cases (a mutual demotion of
  two admins, and a four-way burst) so both adapters are pinned to the same
  contract: exactly one demotion wins and `hasInstanceAdmin` stays true.

### Patch Changes

- Updated dependencies [e779034]
- Updated dependencies [e779034]
- Updated dependencies [e779034]
- Updated dependencies [e779034]
  - @selvajs/platform@0.19.0

## 0.18.0

### Minor Changes

- 679a24f: Invites carry instance permissions; admins no longer set another user's password.

  Creating a user had two shapes depending on the provider: an admin typed someone
  else's password (Local, Supabase), or allowlisted an email and let the IdP hold
  the credential (header-auth/Entra). The first is now gone. A provider that owns
  credentials admits users by invite, so the account holder is the only party who
  ever chooses their password.

  That removal needed a replacement first: the admin-sets-password form was the
  only way to create a second instance admin, so deleting it alone would have left
  a deployment stuck with the admin it bootstrapped with. Invites now carry
  `platformPermissions`, mintable only by a caller who already holds
  `instance_admin` — `manage_org_members` is enough to invite people, so without
  that check an org admin could mint themselves an admin invite and accept it.

  The allowlist path (`createUser`) is untouched — it is the only way into a
  header-auth deployment, and it is now the sole branch of `POST /api/admin/users`.
  The local provider implements no `createUser`, so that route reports 501 there
  and points at invites; the admin UI hides the form to match.

  In the invite form, platform permissions render as their own group. The
  owner/admin role lock renders a checkbox as checked-and-disabled, and reusing it
  across scopes would have granted `instance_admin` to every owner invite.

  Requires `supabase db push` — adds `selva.invites.platform_permissions`.

### Patch Changes

- Updated dependencies [679a24f]
  - @selvajs/platform@0.18.0

## 0.17.0

### Minor Changes

- 4512068: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

### Patch Changes

- 4512068: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.
- 4512068: Fix `createOrg` failing on every org that has no branding assets: `orgToRow` wrote an explicit
  `null` into `selva.orgs.assets`, which is `not null default '{}'::jsonb`.

  `Organization.assets` is optional, so `org.assets ?? null` produced `null` for any org created
  without branding — the overwhelmingly common case. Sending the column explicitly defeats the
  `default '{}'`, which only applies when the column is _omitted_ from the insert, so Postgres rejected
  the row with `null value in column "assets" of relation "orgs" violates not-null constraint`.
  `createOrg` threw before it could seed the owner's `org_members` row, so the failure took org
  creation with it rather than just the asset map.

  `OrgRow.assets` is typed `Record<string, string> | null | undefined`, so the null type-checked
  cleanly — the constraint lives in the migration, not in TypeScript. `orgToRow` now writes `{}`, which
  is both the column default and what `rowToOrg` already round-trips back to `undefined`, so the
  domain-level "no assets" representation is unchanged in both directions.

  Also fixes two stale assertions uncovered while verifying this against a live stack:

  - The storage conformance suite still asserted definition covers land in the **public** bucket.
    Covers were deliberately reclassified as `visibility: 'project'` (auth-gated, served through the
    proxy) when the asset-class registry landed; the route tests were updated then, this one was not.
    Two doc comments in `SupabaseStorageProvider` likewise still claimed covers stay public,
    contradicting the `bucketFor` implementation directly beneath them.
  - `org-conformance` built `SupabaseComputeServerStore` without an at-rest key, so the org-delete
    cascade test could not save a compute server carrying an `apiKey`.

  The suites now skip with a single explanatory warning when the local Supabase stack is unreachable,
  instead of failing every conformance test with an opaque `TypeError: fetch failed`. `.env.test` is
  checked in with local-stack defaults, so its presence alone never meant a stack was actually running
  — which is what kept this bug hidden.

- 4512068: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
  - @selvajs/platform@0.17.0

## 0.17.0-beta.4

### Minor Changes

- 39db6f5: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

### Patch Changes

- Updated dependencies [39db6f5]
  - @selvajs/platform@0.17.0-beta.3

## 0.16.1-beta.3

### Patch Changes

- a011c5e: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

- Updated dependencies [a011c5e]
  - @selvajs/platform@0.16.1-beta.2

## 0.16.1-beta.2

### Patch Changes

- 0e2c428: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.
- Updated dependencies [0e2c428]
  - @selvajs/platform@0.16.1-beta.1

## 0.16.1-beta.1

### Patch Changes

- @selvajs/platform@0.16.1-beta.0

## 0.16.1-beta.0

### Patch Changes

- 3b6746e: Fix `createOrg` failing on every org that has no branding assets: `orgToRow` wrote an explicit
  `null` into `selva.orgs.assets`, which is `not null default '{}'::jsonb`.

  `Organization.assets` is optional, so `org.assets ?? null` produced `null` for any org created
  without branding — the overwhelmingly common case. Sending the column explicitly defeats the
  `default '{}'`, which only applies when the column is _omitted_ from the insert, so Postgres rejected
  the row with `null value in column "assets" of relation "orgs" violates not-null constraint`.
  `createOrg` threw before it could seed the owner's `org_members` row, so the failure took org
  creation with it rather than just the asset map.

  `OrgRow.assets` is typed `Record<string, string> | null | undefined`, so the null type-checked
  cleanly — the constraint lives in the migration, not in TypeScript. `orgToRow` now writes `{}`, which
  is both the column default and what `rowToOrg` already round-trips back to `undefined`, so the
  domain-level "no assets" representation is unchanged in both directions.

  Also fixes two stale assertions uncovered while verifying this against a live stack:

  - The storage conformance suite still asserted definition covers land in the **public** bucket.
    Covers were deliberately reclassified as `visibility: 'project'` (auth-gated, served through the
    proxy) when the asset-class registry landed; the route tests were updated then, this one was not.
    Two doc comments in `SupabaseStorageProvider` likewise still claimed covers stay public,
    contradicting the `bucketFor` implementation directly beneath them.
  - `org-conformance` built `SupabaseComputeServerStore` without an at-rest key, so the org-delete
    cascade test could not save a compute server carrying an `apiKey`.

  The suites now skip with a single explanatory warning when the local Supabase stack is unreachable,
  instead of failing every conformance test with an opaque `TypeError: fetch failed`. `.env.test` is
  checked in with local-stack defaults, so its presence alone never meant a stack was actually running
  — which is what kept this bug hidden.

## 0.16.0

### Minor Changes

- efb003a: Add `ISessionRefresh` — session refresh + server-side revoke

  Session lifecycle now has its own capability, `IAuthProvider.sessionRefresh`,
  holding `refreshSession` and a new `revokeSession`.

  **Why it moved off `IOAuthAuth`.** Refresh and revoke are properties of a
  _session_, not of OAuth. A deployment that brokers no OAuth
  (`oauth.listProviders()` → `[]`) still needs to revoke on logout, and
  previously had to reach into an OAuth capability whose stated precondition it
  did not meet — which worked only because the Supabase adapter constructs its
  OAuth surface unconditionally.

  **`revokeSession` is new behaviour, not a move.** Nothing in the tree could
  invalidate a session server-side. Logout deleted the cookie and the JWT stayed
  valid until natural expiry, so a copy captured elsewhere kept working after the
  user believed they had signed out. The Supabase adapter implements it via
  GoTrue's `admin.signOut(jwt, 'global')`, signing out every session for that
  user rather than only the one the token names.

  It is best-effort and idempotent: revoking an already-revoked, expired, or
  unknown token returns `true` (the desired end state holds), and it never
  throws — a failed revoke must not stop a user from logging out. `false` means
  the session may still be live.

  `IOAuthAuth.refreshSession` is **deprecated but still works**, delegating to the
  new surface for one release. Migrate callers to
  `auth.sessionRefresh?.refreshSession(...)`; it will be removed in the next minor.

  Also corrects `disableUser`'s doc comment, which claimed "Sessions become
  invalid". Disabling sets the metadata flag; adapters verifying tokens locally
  keep accepting an already-issued access token until their next revalidation
  (the Supabase adapter bounds this by `revalidateMs`, default 60s). Callers
  needing immediate cutoff should also call `sessionRefresh.revokeSession`.

### Patch Changes

- Updated dependencies [efb003a]
  - @selvajs/platform@0.16.0

## 0.15.1

### Patch Changes

- 650ef18: Fix two live defects in `SupabaseAuthProvider`: disabled users could refresh
  sessions indefinitely, and `last_login_at` never updated.

  **`refreshSession` did not check `disabled`.** `signIn`, `exchangeOAuthCode`, and
  `verifyMagicLink` all reject users flagged `user_metadata.disabled === true`;
  `refreshSession` did not. This was not a latent gap — the session-refresh
  middleware in `hooks.server.ts` calls it on every request where `verifyToken`
  fails, so a disabled user's expired access token was silently swapped for a
  fresh one on the next request, forever. The `revalidateMs` revocation bound on
  `verifyToken` never applied, because that path had already failed by the time
  refresh ran. Disabling a user now takes effect within one access-token lifetime
  on the refresh path. GoTrue already returns the user alongside the session, so
  the check costs no extra round-trip.

  **`touchLastLogin` wrote to the wrong schema.** Engine tables live in the `selva`
  schema, and every client in `data/client.ts` pins `db: { schema: 'selva' }`. The
  auth provider's service-role client was constructed without that option, so it
  resolved `user_profiles` against `public` — where the table does not exist.
  PostgREST returned a relation-not-found error, and the unchecked `await`
  swallowed it, so `last_login_at` silently never updated in any Supabase
  deployment. Table access now goes through a schema-pinned client, and a failed
  stamp is logged rather than discarded. The write stays best-effort and still
  never throws, per the `IAuthProvider.touchLastLogin` contract.

  `this.admin` is deliberately left unpinned: it drives `auth.admin.*`, which is
  GoTrue's own REST surface and unaffected by the PostgREST schema setting.

  `SupabaseAuthProvider.fromEnv` now accepts an optional second `ILogger`
  argument, matching `HeaderAuthProvider.fromEnv`. Purely additive — omitting it
  keeps the previous `NoopLogger` behavior. `@selvajs/selva` passes its
  `lazyLogger` through, so the failure above is actually visible in the app
  rather than swallowed.

## 0.15.0

### Minor Changes

- 21124cb: Ship the `getServerApiKey` implementations on both compute-server stores
  (`SupabaseComputeServerStore`, `LocalComputeServerStore`).

  The method was added to `IComputeServerStore` and both provider sources in the
  same commit as the structured-logging work, but neither provider carried a
  changeset — so the published `@selvajs/supabase-provider@0.14.4-beta.1` and
  `@selvajs/local-provider@0.12.8-beta.1` tarballs (released three days earlier)
  predate it, while `@selvajs/platform@0.15.0-beta.2` now publishes the interface
  requiring it. Against the published providers, `@selvajs/selva` code paths that
  call `store.getServerApiKey(...)` (compute resolve, admin health/status/actions
  routes) fail with a runtime `TypeError`, and consumers fail to typecheck the
  store against the current platform interface. This release publishes provider
  builds that actually carry the method.

### Patch Changes

- 5077fe9: Adding advanced caching
- 2673995: Extract the definitions server slice into `@selvajs/server/definitions` (embeddable-server-layer K4) and implement the ADR 0005 schema-versioning story:

  - **`@selvajs/server/definitions`** — new subpath exporting `DefinitionService` (write orchestration across data + storage), `fetchSchemaFromCompute` / `SchemaExtractionError` (the upload validate-and-cache gate), `assertSupportedSchemaVersion` (rejects schemas authored with a newer plugin than the app supports), and `createDefinitionLoader` (the render loader, all wiring injected via `DefinitionLoaderDeps`). The loader treats a stored schema as a disposable cache: used only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`, otherwise re-extracted from compute (which runs the C# migrator) and persisted back best-effort.
  - Fixed a latent bug in schema extraction: shallow `camelcaseKeys` is a no-op on arrays, so the PascalCase `Schemas` wrapper key from compute was never normalized; each wrapper element is now camelcased individually.
  - **`@selvajs/supabase-provider`** — new migration adding a `schema_version` GENERATED column on `definition_versions` (derived from `schema->>'schemaVersion'`, ops/diagnostics only).
  - **`@selvajs/selva`** — `DefinitionService`, `schemaExtraction.server`, and `loadForRender.server` are now thin bindings over `@selvajs/server/definitions`.

- Updated dependencies [5077fe9]
- Updated dependencies [b8607d4]
- Updated dependencies [243ae19]
- Updated dependencies [a8e1b47]
  - @selvajs/platform@0.15.0

## 0.15.0-beta.3

### Patch Changes

- Adding advanced caching
- Updated dependencies
  - @selvajs/platform@0.15.0-beta.4

## 0.15.0-beta.2

### Minor Changes

- 21124cb: Ship the `getServerApiKey` implementations on both compute-server stores
  (`SupabaseComputeServerStore`, `LocalComputeServerStore`).

  The method was added to `IComputeServerStore` and both provider sources in the
  same commit as the structured-logging work, but neither provider carried a
  changeset — so the published `@selvajs/supabase-provider@0.14.4-beta.1` and
  `@selvajs/local-provider@0.12.8-beta.1` tarballs (released three days earlier)
  predate it, while `@selvajs/platform@0.15.0-beta.2` now publishes the interface
  requiring it. Against the published providers, `@selvajs/selva` code paths that
  call `store.getServerApiKey(...)` (compute resolve, admin health/status/actions
  routes) fail with a runtime `TypeError`, and consumers fail to typecheck the
  store against the current platform interface. This release publishes provider
  builds that actually carry the method.

## 0.14.4-beta.1

### Patch Changes

- Updated dependencies
  - @selvajs/platform@0.15.0-beta.1

## 0.14.4-beta.0

### Patch Changes

- 2673995: Extract the definitions server slice into `@selvajs/server/definitions` (embeddable-server-layer K4) and implement the ADR 0005 schema-versioning story:

  - **`@selvajs/server/definitions`** — new subpath exporting `DefinitionService` (write orchestration across data + storage), `fetchSchemaFromCompute` / `SchemaExtractionError` (the upload validate-and-cache gate), `assertSupportedSchemaVersion` (rejects schemas authored with a newer plugin than the app supports), and `createDefinitionLoader` (the render loader, all wiring injected via `DefinitionLoaderDeps`). The loader treats a stored schema as a disposable cache: used only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`, otherwise re-extracted from compute (which runs the C# migrator) and persisted back best-effort.
  - Fixed a latent bug in schema extraction: shallow `camelcaseKeys` is a no-op on arrays, so the PascalCase `Schemas` wrapper key from compute was never normalized; each wrapper element is now camelcased individually.
  - **`@selvajs/supabase-provider`** — new migration adding a `schema_version` GENERATED column on `definition_versions` (derived from `schema->>'schemaVersion'`, ops/diagnostics only).
  - **`@selvajs/selva`** — `DefinitionService`, `schemaExtraction.server`, and `loadForRender.server` are now thin bindings over `@selvajs/server/definitions`.
  - @selvajs/platform@0.14.3-beta.0

## 0.14.3

### Patch Changes

- 2173bef: Fix Supabase local port configuration and wire the solve-metric sink into the server test setup.

## 0.14.2

### Patch Changes

- @selvajs/platform@0.14.2

## 0.14.1

### Patch Changes

- @selvajs/platform@0.14.1

## 0.14.0

### Minor Changes

- fed3a9e: Capture per-solve timing and outcome telemetry.
  - **platform**: new pluggable `ISolveMetricSink` provider (`SelvaConfig.solveMetrics`, defaults to `NoopSolveMetricSink`). A `SolveMetric` records the solve's wall-clock `durationMs`, `ok`, a `failureKind` (`timeout` | `client_abort` | `rate_limited` | `share_cap` | `too_large` | `compute_error` | `ok`), Grasshopper `errorCount`/`warningCount`, and attribution: `definitionId` + `versionId` (so timings compare across definition versions), `orgId`, and `channel`. Adds the `runSolveMetricSinkConformance` testing suite.
  - **supabase-provider**: `SupabaseSolveMetricSink` persists every solve to the new `selva.solve_metrics` table (with the triggering user in `actor_id`). Exposed off `SupabaseDataProvider` so it wires automatically when the Supabase data provider is selected. Includes the migration and a conformance test.
  - **selva**: the compute route now records one metric per solve attempt — including attempts rejected before the solve runs (rate limit, share-link cap) — and distinguishes a genuine solve timeout from a client disconnect. A successful solve of a local definition also bumps that definition's `solveCount` (the "N runs" stat shown on definition cards/lists), which was previously never incremented.

### Patch Changes

- Updated dependencies [fed3a9e]
  - @selvajs/platform@0.14.0

## 0.13.5

### Patch Changes

- 2655d2e: Soft-deleted projects no longer occupy their slug/name permanently. The schema's
  `(org_id, slug)` and `(org_id, lower(name))` uniqueness guards were unconditional,
  so a tombstoned project — invisible to every store read (which filter
  `deleted_at is null`) — still blocked recreating a project on the same slug/name
  (`createProject` hit 23505). Both guards are now partial unique indexes
  `where deleted_at is null`, matching the rest of the schema, so create-after-delete
  just works.
- Updated dependencies [8039673]
  - @selvajs/platform@0.13.0

## 0.13.5-beta.2

### Patch Changes

- 2655d2e: Soft-deleted projects no longer occupy their slug/name permanently. The schema's
  `(org_id, slug)` and `(org_id, lower(name))` uniqueness guards were unconditional,
  so a tombstoned project — invisible to every store read (which filter
  `deleted_at is null`) — still blocked recreating a project on the same slug/name
  (`createProject` hit 23505). Both guards are now partial unique indexes
  `where deleted_at is null`, matching the rest of the schema, so create-after-delete
  just works.

## 0.13.5-beta.1

### Patch Changes

- Roll beta prerelease.

## 0.13.5-beta.0

### Patch Changes

- 9712a7f: Fix soft-deleted projects permanently occupying their slug and name. The `(org_id, slug)` and `(org_id, lower(name))` uniqueness guards were unconditional, so a tombstoned project blocked re-creating a project with the same slug/name even though every store read filters `deleted_at is null`. Replaced both with partial unique indexes (`where deleted_at is null`), matching the rest of the schema, so create-after-delete works.

## 0.13.4

### Patch Changes

- @selvajs/platform@0.12.3

## 0.13.3

### Patch Changes

- @selvajs/platform@0.12.2

## 0.13.2

### Patch Changes

- @selvajs/platform@0.12.1

## 0.13.1

### Patch Changes

- 1f6afe3: Pin `selva.set_updated_at()` to an empty `search_path` via a new migration, resolving the Supabase linter `function_search_path_mutable` warning.

## 0.13.0

### Minor Changes

- e7d2adb: Move all engine tables into a dedicated `selva` Postgres schema instead of `public`.

  A consuming app sharing the same database now keeps `public` entirely for its own tables — `selva.projects` and a consumer's `public.projects` can coexist, removing the name-clash that previously forced consumers to rename around the engine. The data clients are constructed with `db: { schema: 'selva' }`, the initial migration creates the schema, grants the standard roles, and exposes it to PostgREST via `alter role authenticator set pgrst.db_schemas` (done from the migration, not `config.toml`, to avoid the boot-before-migrations race).

  **Breaking for existing databases on the old `public` layout.** This is a table relocation, not an additive change. A fresh install (`db reset` / first `db push`) just works. A database with live data on the old layout needs a data-preserving `alter table … set schema selva` migration path — not covered by the fresh-install SQL. Consumers referencing engine objects from their own migrations must qualify them with `selva.` (`references selva.orgs`, `selva.is_org_member()`, `selva.is_instance_admin()`, `selva.set_updated_at()`).

  Also fixes a pre-existing missing UPDATE RLS policy on `definition_versions` that caused `setVersionSchema` to silently write 0 rows for user-scoped callers.

## 0.12.0

### Minor Changes

- 9ded581: Cache each definition version's compute-extracted UI schema on the version row, and make schema extraction a hard upload gate.

  `DefinitionVersion` gains optional `schema` + `schemaExtractedAt`, and `IDefinitionStore` gains `setVersionSchema`. On upload, the schema is now extracted and validated against Rhino.Compute **before** any blob or version row is written — a compute outage or a definition with no valid `Schema` output rejects the upload (503 / 422) with nothing persisted. The render path reads the cached schema instead of re-fetching it from compute on every load, falling back to a live fetch (plus a temporary solve-time backfill) for versions uploaded before this change.

  `@selvajs/platform` now re-exports the `UISchema` type from `@selvajs/schemas` (types-only dependency). The Supabase provider adds a `0002` migration creating `definition_versions.schema` / `schema_extracted_at` (and the previously-missing `change_note`) columns.

### Patch Changes

- Updated dependencies [9ded581]
- Updated dependencies [9ded581]
  - @selvajs/platform@0.12.0

## 0.11.0

### Minor Changes

- Publish the platform interface package and its local + Supabase provider
  implementations to npm. These were previously workspace-private; they are now
  public so external apps can build on the Selva engine (provider interfaces +
  reference implementations) without vendoring the source.

### Patch Changes

- Updated dependencies [3e5ebe3]
- Updated dependencies
  - @selvajs/platform@0.11.0

## 0.2.0

### Minor Changes

- # 0.10.0

  A broad release covering platform foundations, a new drawing/PDF pipeline, unified drag-and-drop, schema-source-of-truth work, and a new forward-auth provider. Web apps and `@selvajs/ui` are aligned at 0.10.0; library packages move to the next minor in their respective tracks. The Grasshopper plugin ships as 0.10.0 (beta tag dropped).

  ## Apps & UI (`@selvajs/plugin-ui`, `@selvajs/selva`, `@selvajs/ui`)

  ### Plugin-UI
  - Unified drag-and-drop on `svelte-dnd-action` with a thin cross-type coordinator (replaces three coexisting systems).
  - Schema source-of-truth refactor: canonical/draft split, content-hash for safe save, removal of version/edit-intent state, eliminates drift between plugin `_embeddedSchema`, UI state, and localStorage.
  - New components: `ImageUploadField`, `DataTable`, mode toggle, resizable, scroll-area, search, select, separator, slider, sonner, switch, tabs, textarea, theme switcher.
  - `NumberWidgetConfig` gains `hideRange` for UI control.
  - External input handling with a UI toggle for input sources.
  - Resizable-handle styling, grid-item visibility + column positioning, dropzone active-state highlights.
  - Compute throttle + solving indicator; util reorganisation.

  ### Selva
  - Project-owner definition uploads with access-control tests.
  - Project visibility handling tightened in access-control logic.
  - StatCard refactor across project/team pages and updated project navigation.
  - Audit-log functionality with query support and UI integration.
  - API endpoints for managing platform projects and grants; reclaim functionality.
  - Email-link authentication.
  - Compute-server management refactored to support platform and org-private servers; permissions docs clarified for role scopes.

  ### Cross-cutting UI
  - WebSocket connection handling and schema-history management hardened.
  - Schema history + validation improvements.
  - `NotificationManager` interface + implementation for message handling.
  - Primitive imports and layout-structure refactor; component conventions normalised (see plugin-ui `lib/README`).

  ## Drawing system (`Selva.Drawing` + UI)
  - New SVG drawing components, dimensioning, curve creation, and export.
  - `GH_Page`, `GH_PathStyle` improvements; `RhinoViewportVisitor` rendering enhancements.
  - `DrawingView` / `GH_DrawingView` support multiple geometry elements with auto-fit.
  - New table/grid header-style + fill options.
  - Document layout + pagination logic refactor; `GridOverflow` class + `ComputeOverflows` method for multi-page output.
  - New icons and a page-flow plan for multi-page output.

  ## Schemas (`@selvajs/schemas`)
  - Modular Zod-based validation system for `UISchema`.
  - Custom `IGH_Goo` types for `ValueList`, `ThreeMaterial`, `FileData`, `UISchema` with serialization.
  - `SchemaArchiveSerializer` for schema + values archive serialization.

  ## Platform & providers
  - `@selvajs/header-auth-provider` (new): forward-auth via trusted upstream proxy. Identity verification from proxy headers, allowlist management for user entries.
  - `@selvajs/platform`: project-grant store + interfaces; reclaim flow; clearer role scopes.
  - `@selvajs/local-provider`: env-var handling refactor.

  ## Plugin (.NET / Grasshopper)
  - WebSocket message handling and validation overhauled.
  - Document synchronization and schema handling refactor.
  - Robust volatile + persistent parameter-value extraction.
  - Multi-target: net48 + net7.0 (Rhino 8), net9.0 (Rhino 9-wip) with separate `manifest-rh8.yml` / `manifest-rh9.yml`. Rhino 7 is not supported.
  - Grasshopper group import + enhanced grouping options.
  - `BinaryGeometryWriter` for optimized mesh delivery.
  - `ValueApplicator` + `ValueCollector` services replace ad-hoc plumbing in UIBuilder.
  - Install-directory resolution improvements in the update script.

  ## Tooling, infra, docs
  - Turborepo integration: `pnpm build` / `check` / `type-check` / `test` / `generate` orchestrated via turbo with caching (see `docs/Turborepo.md`).
  - New data-directory layout + setup script changes.
  - PM2 deployment: `--env-file` flag via `node_args` (replaces silently-ignored `env_file` on `pm2 start`).
  - `@selvajs/schemas` workspace dependencies normalised to `workspace:*`.
  - Grasshopper example definitions unignored.
  - Added CONTRIBUTING + changelog; TypeScript schema generation pipeline.

### Patch Changes

- Updated dependencies
  - @selvajs/platform@0.2.0
