# @selvajs/local-provider

## 0.16.1-beta.3

### Patch Changes

- 28e2b9a: A Compute API key sealed by a newer Selva than the one running is no longer reported as plaintext. Both compute-server stores return the server without a key and log what happened, `verifySecrets` reports the new reason `unknown_envelope`, and system health and `selva update` name the downgrade. `@selvajs/platform/computeServer` gains `isUnknownEnvelope`.

  `/admin/compute` can replace a key the local store cannot read. Reading keys for a save used to throw on a plaintext key, so the save that the error message asked for failed with a 500. Reads that use the key still throw on plaintext.

  The CLI help and docs say that `npx selva` outside a deployment directory resolves to an unrelated npm package.

- Updated dependencies [28e2b9a]
  - @selvajs/platform@1.1.0-beta.4

## 0.16.1-beta.2

### Patch Changes

- d424587: Deleting a user on Supabase removes the invites addressed to them, and redacts their address from `invite.created` audit payloads, whatever case the address arrives in. Before, an address whose case differed from the stored, lowercased one left those rows behind. The local provider already matched case-insensitively; it no longer emits an `org_member.removed` event for each org it erases the user from.

  Conformance kit: `runUserErasureConformance` checks what `IDataProvider.onUserDeleted` removes (invites to and from the user, their API tokens, memberships and profile) and what it keeps (the orgs and projects they owned, under `ERASED_ACTOR_ID`). `runProjectStoreConformance` takes `orgScoping`, with `otherOrgId` from `createStore`, to check that slug lookups and listings stay inside the org asked for.

- Updated dependencies [d424587]
- Updated dependencies [d424587]
  - @selvajs/platform@1.1.0-beta.2

## 0.16.1-beta.1

### Patch Changes

- 02f41e4: An invite whose permissions or membership could not be applied after it was claimed is handed back, so the invitee can open the link again instead of needing a new invite. `IInviteStore` gains an optional `reopen`, implemented by the local and Supabase stores; the conformance suite tests it under the `reopen` option.
- Updated dependencies [02f41e4]
- Updated dependencies [8602332]
  - @selvajs/platform@1.1.0-beta.1

## 0.16.1-beta.0

### Patch Changes

- b38182e: Compute API keys are sealed in a new `enc:v3:` envelope that binds both the server id and its URL, so a row whose `serverUrl` is edited at rest no longer decrypts and sends its key to the new host. Both compute-server stores seal and re-seal on save, `reencryptSecrets` moves `enc:v1:`/`enc:v2:` rows to v3, and `verifySecrets` reports them in `legacyEnvelopes`. v1 and v2 still decrypt. Decryption also pins a 16-byte GCM tag. `encryptSecret`, `decryptSecret` and `decryptWithKeys` accept a `{ id, url }` binding alongside the old string; new exports on `./computeServer`: `readAtRestKeys`, `parseKey32`, `isLegacyEnvelope`, `SecretBinding`.
- b38182e: Store fixes across both providers:

  - `markAccepted` refuses an expired invite.
  - A share link stops counting solves once its definition is deleted. On Supabase this is a new migration: run `npx selva-supabase` and `supabase db push`.
  - Supabase emits `definition.deleted` only when a row was deleted, and `listUsers` and the audit query clamp their limit (`limit: 0` returns one row; the audit default is now 50).
  - Local's `revoke` of an unknown share link is a 404, and local storage refuses a bad path with `ProviderError` 400.
  - Supabase has no platform-project grants, so provider setup now fails when `ENABLE_PLATFORM_PROJECTS` is on. `IPlatformProjectGrantStore` gains an optional `unsupported` marker.

- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
- Updated dependencies [b38182e]
  - @selvajs/platform@1.1.0-beta.0

## 0.16.0

### Minor Changes

- edb568d: No more lost writes, full erasure, and API token storage.

  - Every store's read-modify-write runs alone through `withFileLock`, so concurrent saves can't drop an invite, grant, share link or compute server, and a revoked one can't come back. A share link's `maxSolves` holds under concurrent solves.
  - Cached stores share `CachedJsonFile`: a failed write isn't served from memory, a file that failed to parse recovers once repaired, and the newest state wins.
  - On Windows, a write that replaces a file someone is reading retries briefly instead of failing with `EPERM`.
  - `LocalStorageProvider.put` writes through a temp file and returns the stored path. It refuses `.json` files in the storage root, which holds `auth-users.json`.
  - `onUserDeleted` removes the user's invites, memberships, grants, share links and API tokens; orgs, projects, definitions and versions stay under `ERASED_ACTOR_ID`. `deleteOrg` soft-deletes the org's definitions.
  - New `LocalApiTokenStore`, with serialized writes, wired into org delete and user erasure.
  - The compute store refuses a server id another org or the platform already uses (409), binds each stored key to its server id (`enc:v2:`), and rewrites `enc:v1:` keys on the next save.
  - Batch reads `getDefinitionsFor` and `listVersionsFor`.
  - `/config` exports this provider's env slice.

### Patch Changes

- Updated dependencies [90d0073]
- Updated dependencies [edb568d]
  - @selvajs/platform@1.0.0

## 0.16.0-beta.6

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

## 0.16.0-beta.5

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

## 0.16.0-beta.4

### Patch Changes

- 3ba8225: The local compute store refuses a server id that another org or the platform already uses, with a 409, as Supabase does. Keys are looked up by id alone, so an org admin who knew another tenant's server id could have had that tenant's Rhino.Compute key sent to their own URL. The compute store conformance suite now checks both providers for this.
- Updated dependencies [3ba8225]
  - @selvajs/platform@1.0.0-beta.8

## 0.16.0-beta.3

### Minor Changes

- eebd2f6: The local provider no longer loses writes, and erasure now reaches everything on disk.

  - Every store's read-modify-write runs alone through `withFileLock`, so concurrent saves can't drop an invite, a grant, a share link or another org's compute servers, and a revoked invite or grant can't come back. A share link's `maxSolves` holds under concurrent solves.
  - The cached stores share `CachedJsonFile`: a failed write is no longer served from memory, a file that failed to parse recovers once repaired, and the newest state wins overlapping writes.
  - `LocalStorageProvider.put` writes through a temp file, so a concurrent `get` can't come back short. It refuses `.json` files in the storage root, which is `DATA_PATH` and holds `auth-users.json`.
  - `deleteOrg` soft-deletes the org's definitions, and `IOrgStore.deleteOrg`'s doc now lists what cascades.
  - `onUserDeleted` removes invites to or from the user, their membership rows, user grants and the share links they minted. Orgs, projects, definitions and versions stay, under `ERASED_ACTOR_ID`.

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

### Patch Changes

- b6935ce: Access-rule fixes and closed races.

  - `canCreateDefinition` on a commons project now requires `canView`. With `ALLOW_CROSS_ORG_PUBLIC` off, someone outside the org can't upload to a commons project, or move a definition into one.
  - `canView` passes for a project member at any non-`platform` visibility, so an outside `instance_admin` who reclaimed a project can open it.
  - `hasPermission` is false for a share-link context, which runs as `system` only to pick the service-role client.
  - With `ENABLE_PLATFORM_PROJECTS` off, `instance_admin` can no longer edit or delete a platform project.
  - Two admins deleting each other no longer leave the instance with none: the delete revokes first, through the atomic `set`, and restores the permissions if the delete doesn't happen.
  - Two project owners demoting or removing each other no longer leave zero owners.
  - `PATCH /api/admin/users/[id]` refuses to make a disabled user an instance admin.
  - Accepting an invite adds its platform permissions to what the user already holds instead of replacing them.
  - A double submit on accept-invite creates one account on local and header-auth, and local `markAccepted` emits once.

- 817af19: Stored compute ciphertext can no longer be replayed to decrypt someone else's API key.

  - `encryptSecret` and `decryptSecret` take an optional `aad`. With it, `encryptSecret` writes an `enc:v2:` envelope bound to that value. `enc:v1:` envelopes still read, and a store rewrites them as `v2` the next time their server is saved.
  - Both compute stores bind each key to its server id and refuse a value that's already an envelope, instead of passing it through.
  - `validateIncomingServers` rejects an `apiKey` that looks like an envelope, on both the admin and org compute routes.
  - On Supabase, sessions can no longer select `compute_servers.api_key`. The store reads keys with the service role, and only for servers the session's own read can see.

  Apply this release's migration: run `npx selva-supabase`, then `npx supabase db push`. Host apps that select `api_key` with a session JWT have to move that read behind the service role.

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

## 0.16.0-beta.2

### Patch Changes

- 493612c: Upload-only API tokens and the Grasshopper plugin's sign-in.

  - A key whose scopes only read and upload may be held by anyone who can create a definition in one project of the token's org; anything broader still needs `manage_api_tokens`. Checked at mint and on every request.
  - **Breaking:** `ApiTokenHolderPolicy` is `(ctx, scopes) => boolean | Promise<boolean>`, and `canHoldApiTokens(ctx, scopes, { policy, deps })` is async. `ResolveApiTokenDeps.data` also needs `projects`, `platformProjectGrants` and `definitions`, plus an optional `flag`.
  - OAuth knows a built-in client, `selva-grasshopper`, which redirects only to `http://127.0.0.1/callback` on any port and is the only client that may be granted the new `upload` scope. Registered clients asking for it get read and solve at most. `consentChoices`, `consentOrgs` and `mintConsentToken` let a consent page mint in an org the user picks, through `mintApiToken`, the same core as the token endpoint.
  - `revokeOwnApiToken` lets a key revoke itself; `runHandler`'s `anyScope` opens a route to every key.
  - `GET /projects` items gain `canCreateDefinitions`, `GET /definitions/{guid}` gains `canEdit` and `sourceDocumentId`, list items gain `sourceDocumentId`, and `GET /definitions?documentId=` finds the definitions from one Grasshopper document the caller can upload to. `/me` reports the key's `expiresAt`.
  - Supabase: migration `20261021120000_selva_definition_source_document` adds `definitions.source_document_id`.

- Updated dependencies [65786d5]
  - @selvajs/platform@0.21.0-beta.3

## 0.16.0-beta.1

### Patch Changes

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

- Updated dependencies [ef94b55]
  - @selvajs/platform@0.21.0-beta.2

## 0.16.0-beta.0

### Minor Changes

- d50c8fa: API tokens, resolution and enforcement (no minting UI yet).

  - `@selvajs/platform`: `ApiToken`, `IApiTokenStore` (optional `apiTokens` on `IDataProvider`), `scopeAllows`, `narrowApiTokenContext`, `apiScope` on `RequestContext`, the `manage_api_tokens` and `read_all_org_projects` permissions, `api_token.*` events, and `actorOf`, which adds `tokenId` to events written during a token request. `read_all_org_projects` is not in the owner/admin defaults.
  - `@selvajs/server`: `resolveApiToken` and `buildRequestContext` in `/http`; `createApiTokenCodec` (`selva_` keys with a checksum) in `/tokens`; `runHandler` checks API-token scopes, with `action` and `scopeTarget` options; `ApiError` gains `details`; new code `API_TOKENS_UNAVAILABLE`.
  - `@selvajs/local-provider`: `LocalApiTokenStore`, wired into the org-delete cascade and user erasure.
  - `@selvajs/selva`: the hook resolves `Authorization: Bearer selva_…` on `/api/v1/*` before the cookie, and a bad key never falls back to the session.

### Patch Changes

- Updated dependencies [d50c8fa]
- Updated dependencies [5a96097]
- Updated dependencies [5a96097]
  - @selvajs/platform@0.21.0-beta.0

## 0.15.3

### Patch Changes

- f763878: Document that `GuidSchema` is the prototype-pollution guard for the definition stores.

  The stores index plain objects by guid (`config.definitions[guid]`), so the UUID regex is
  load-bearing beyond format validation: it is what keeps `__proto__` and `constructor` out of
  a key position. `LocalDefinitionStore.live()` does not stop a prototype lookup on its own —
  `definitions['__proto__']` returns `Object.prototype`, whose `deletedAt` is undefined, so it
  passes as a live record and the caller's `Object.assign` writes onto the prototype.

  Comments only; no behavior change. Both are noted at the point a future entry point would
  have to preserve the invariant.

- Updated dependencies [f763878]
  - @selvajs/platform@0.20.1

## 0.15.2

### Patch Changes

- Updated dependencies [4d16b79]
  - @selvajs/platform@0.20.0

## 0.15.1

### Patch Changes

- 66945ae: Close the six findings from the app security audit.

  **One setting needs an operator's hand — the code cannot apply it.**

  `ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH=<proxy count>` were already documented but unset. Without them `getClientAddress()` returns the socket peer, which behind a reverse proxy is `127.0.0.1` for every request from every user — so the login limiter had exactly one bucket. Five failed logins from anywhere returned 429 to everyone, and only a successful login clears a bucket, which nobody could then reach. Cheap unauthenticated denial of service against a whole instance, renewable indefinitely.

  Four changes cover the gap until an operator sets them. A per-account failure counter now runs alongside the per-IP one, keyed on the normalized email — per-IP bounds nothing against an attacker spread across source addresses, and per-account is what protects a targeted user. The app logs a warning the first time a login arrives from loopback with `ADDRESS_HEADER` unset. `selva doctor` reports the pair as red when `ORIGIN` is set (a proxy is in play) and `ADDRESS_HEADER` is not, and yellow when `X-Forwarded-For` is trusted without an `XFF_DEPTH` to say which hop is real. And `selva proxy` prints the two lines to add after it configures Caddy, since that is the moment the operator creates the condition.

  Doctor stays quiet when `ORIGIN` is unset. On a directly-reachable app these settings are a footgun — `X-Forwarded-For` is client-supplied, so trusting it there lets any caller choose their own rate-limit bucket.

  Caddy needs no change: `reverse_proxy` already sends the header. Only the app's willingness to trust it was missing.

  **The rest carry no deployment impact.**

  A compute `serverUrl` saved at `/admin/compute` is validated: `http`/`https` only, and never the link-local range. That URL is fetched server-side on every status probe and every solve, so an unfiltered one lets whoever holds `manage_compute` point the app at `http://169.254.169.254/latest/meta-data/` and read the host's own cloud credentials. Loopback and LAN addresses stay allowed, since running compute on `localhost` or an internal box is the ordinary self-hosted layout — blocking those would break working deployments and push operators toward disabling the guard entirely. `169.254.0.0/16` is the one range no legitimate compute server uses.

  `/admin/*`, `/setup` and `/login` are no longer framable. Selva apps are built for iframe embedding and app routes stay that way, but that tradeoff was being applied uniformly, leaving an authenticated instance admin open to UI-redress. `applySecurityHeaders` gained an opt-in `denyFraming` option — additive, so existing callers are unaffected.

  The OAuth callback checks a CSRF nonce before exchanging the code. It is a GET that mints a session cookie, and SvelteKit's origin check only covers form POSTs, so an attacker could capture a `?code=` from their own flow and induce a victim to load it — silently signing the victim into the attacker's account, where everything they then do is visible. Supabase does not expose the real OAuth `state` and `exchangeOAuthCode` takes only `code`, so the nonce is minted at `/auth/supabase/start`, carried on the callback URL, and compared against a short-lived cookie. Single-use, cleared on failure as well as success.

  `auth-users.json` and `compute.config.json` are written `0600` in a `0700` directory. The shared write helper set no mode, and `rename` preserves the temp file's umask bits, so PBKDF2 password hashes were landing world-readable — any other local user or co-tenant service on the host could copy and crack them offline. No-op on Windows.

  API 500s log through pino instead of raw `console.error`. Provider adapters stash connection details on `cause`, and handing that object to stdout puts it somewhere redaction never runs and erasure cannot follow.

  `SELVA_HMAC_KEY` now refuses the `.env.example` placeholder. At 41 characters it cleared the 32-char minimum, so an operator who copied the file without rotating booted with a session-signing key that is public in this repo — every token forgeable. `selva doctor` caught it, but nothing forces anyone to run doctor.

- Updated dependencies [6fa6b27]
  - @selvajs/platform@0.19.1

## 0.15.0

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

## 0.14.1

### Patch Changes

- Updated dependencies [679a24f]
  - @selvajs/platform@0.18.0

## 0.14.0

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

## 0.14.0-beta.3

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

## 0.13.2-beta.2

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

## 0.13.2-beta.1

### Patch Changes

- 0e2c428: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.
- Updated dependencies [0e2c428]
  - @selvajs/platform@0.16.1-beta.1

## 0.13.2-beta.0

### Patch Changes

- @selvajs/platform@0.16.1-beta.0

## 0.13.1

### Patch Changes

- Updated dependencies [efb003a]
  - @selvajs/platform@0.16.0

## 0.13.0

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

- Updated dependencies [5077fe9]
- Updated dependencies [b8607d4]
- Updated dependencies [243ae19]
- Updated dependencies [a8e1b47]
  - @selvajs/platform@0.15.0

## 0.13.0-beta.2

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

## 0.12.8-beta.1

### Patch Changes

- Updated dependencies
  - @selvajs/platform@0.15.0-beta.1

## 0.12.8-beta.0

### Patch Changes

- @selvajs/platform@0.14.3-beta.0

## 0.12.7

### Patch Changes

- @selvajs/platform@0.14.2

## 0.12.6

### Patch Changes

- @selvajs/platform@0.14.1

## 0.12.5

### Patch Changes

- Updated dependencies [fed3a9e]
  - @selvajs/platform@0.14.0

## 0.12.4

### Patch Changes

- Updated dependencies [8039673]
  - @selvajs/platform@0.13.0

## 0.12.3

### Patch Changes

- @selvajs/platform@0.12.3

## 0.12.2

### Patch Changes

- @selvajs/platform@0.12.2

## 0.12.1

### Patch Changes

- @selvajs/platform@0.12.1

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
