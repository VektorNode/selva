# `docs/` validation

Fact-checks all 52 files under `docs/` against the tree, then asks of every paragraph whether it earns
its place. There was no review document to validate, so the docs themselves were the claims. Line
numbers drift: when one stops resolving, grep the quoted text. The doc edits in sections 1 and 3 were
applied afterwards, so read them as the record of why the docs changed. `scaling-roadmap.md` and
`drawing-backlog.md` moved to `plans/`; `/setup` now honours the pinned bootstrap email; the scaffold
binds `127.0.0.1` when an origin is given. Doctor and the admin health panel now warn when `ADDRESS_HEADER` is trusted on a public bind, and the
Caddy templates write `256MiB`. Still open in code: the Update button shown to `manage_updates`
holders, the "`Infinity` throws" message in `checks/config.js` and `deploymentConfig.ts`, and the
password-recovery gap.

**How this was checked.** Nine agents. Seven Sonnet readers took one slice of the docs each and opened
the code behind every checkable claim. One Opus agent read across all docs for duplication,
contradictions and gaps. One Haiku agent swept env vars, CLI flags and ports. About 2,000 claims were
checked and about 280 came back WRONG or PARTLY. Counts are the agents' own.

Reproduced, not just read:

- Caddy 2.11.4 `caddy adapt` and `validate` on the shipped Caddyfile and the `:80 { ... }` one-liner, and
  forwarded-for handling behind default Caddy.
- adapter-node 5.5.7 `parse_as_bytes`.
- The local provider's `/setup` gate with no `auth-users.json`.
- The magic-link URL parse, rerun by the orchestrator.
- A link-graph script and an env-var diff over `packages/selva/src`.

I opened the code behind about 35 of the WRONG rows, spread across every slice, and all held. Rows
judged by an agent's reading alone are tagged `read-only` where it matters. Agents reported only the
non-confirmed claims, so the 1-in-5 sample of CONFIRMED rows was not drawn.

**Not verified.**

- Anything inside the VektorNode Compute fork (header collisions, a pre-solve hook,
  `RHINO_COMPUTE_ABORT_ON_HANGUP`). Its source is not in the tree.
- Vendor behaviour: Entra portal steps, oauth2-proxy options, Supabase dashboard labels and GoTrue
  `.RedirectTo` contents, Rhino 9 on Linux, core-hour billing.
- Ship and removal dates and "was previously X" history. The repo is one squashed commit.
- Memory figures (the 250 MB / 4-5 copies / ~1 GB in ADR 0003).
- The "200 with 401 JSON" login response in `cli.md:101`, which needs a live curl.
- "Drift verified to bite" (ADR 0002), which needs `dotnet test` and vitest.
- No build, type-check, lint or test baseline was run. The docs have none, and the repo's verification
  is expensive.

## 1. Corrections

### Fix first: operators copy these or lose security from them

- **`Caddyfile.example:41` does not load.** `request_body { max_size 256mb }` on one line fails with
  "Unexpected next token after '{' on same line". `reverse-proxy.md:23` has the same flaw:
  `:80 { reverse_proxy ... }` fails with "Unexpected '}'". Caddy needs a newline after `{`. `256mb`
  also adapts to 256,000,000 bytes, below the 256 MiB app caps the comment says it must clear; use
  `256MiB`. `reproduced`
- **Bind address.** `cli.md:105` ("binds 127.0.0.1 only") and `supabase.md:177` ("`npm start` binds to
  `127.0.0.1:3000`") are wrong. The CLI sets `HOST=127.0.0.1` only for header auth
  (`packages/cli/src/prompts.js:107-108`); otherwise `HOST` defaults to `0.0.0.0`
  (`packages/selva/.env.example:329`). `security-and-limits.md:108` is right.
- **`supabase.md:235,249` local ports.** Docs say 54321 to 54324. `supabase/config.toml` sets API 54421,
  DB 54422, Studio 54423, mail 54424. `SUPABASE_URL` in the example should be `http://127.0.0.1:54421`.
  `supabase/README.md:103` and `.env.example:213` carry the same stale port.
- **`supabase.md:197` "additive, safe while the old app serves".** False for the `20261101*` set:
  `revoke_privileged_functions` revokes execute, `rls_is_the_boundary` drops policies and revokes
  update, `compute_api_key_private` revokes select, `erasure_keeps_tenant_data` drops foreign keys. An
  old app calling a revoked function or column fails.
- **`supabase.md:153,166` magic-link template.** `{{ .RedirectTo }}?token_hash=...` appends a second `?`
  when the callback URL already carries `?redirectTo=` (`routes/auth/email/start/+page.server.ts:56-60`).
  Parsed: `token_hash` is `null` and `redirectTo` swallows it. Line 166's expected URL
  (`redirectTo=...&token_hash=...`) contradicts the template. Whether GoTrue's `.RedirectTo` keeps the
  query is unverified. `reproduced`
- **Local admin recovery has four recipes and one works.** `cli.md:101` (delete `auth-users.json`, then
  `/setup`), `quick-start.md:80` (delete `DATA_PATH`), `admin.md:37` (`BOOTSTRAP_INSTANCE_ADMIN_EMAIL`
  "restores access"), `contributing/permissions.md:51` (edit `users.json`). The `/setup` gate reads
  `platformPermissions` in `user-data.json`, so after `auth-users.json` is gone `hasInstanceAdmin` is
  still true and `/setup` redirects to `/login`. Bootstrap runs only on identity-provider callbacks and
  only while no admin exists. `users.json` does not exist. Only `quick-start.md:80` works. `reproduced`
- **`security-and-limits.md:51` "`256mb` and `Infinity` throw on boot".** Only `256mb` does; adapter-node
  parses `Infinity` as `Infinity`. The same sentence is in `.env.example`, `cli/src/checks/config.js` and
  `server/src/ops/deploymentConfig.ts`. Unset `BODY_SIZE_LIMIT` falls back to 512 KB, so every upload
  returns 413; `256M` is only the seeded value. `reproduced`
- **Who runs an update.** `self-hosting/permissions.md:49`, `admin.md:21` and
  `contributing/permissions.md:34,648` give it to `manage_updates`. `api/admin/system/update/+server.ts:51,266`
  requires `instance_admin`; `manage_updates` only gates the System panel and `setChannel`.
- **`self-hosting/permissions.md:44-51`** lists four platform permissions and says any one admits you to
  `/admin`. There are five. `manage_api_tokens` is excluded from `OPERATOR_PLATFORM_PERMISSIONS`
  (`platform/src/permissions/types.ts:13-30`).
- **`quick-start.md:46`** says `pnpm dev:selva` serves `:5173`. It serves `:5199`
  (`packages/selva/vite.config.ts:8`, `strictPort`). `5173` is plugin-ui.
- **`reverse-proxy.md:36-40`.** The forwarded-for rows work only if Caddy has `trusted_proxies`. Default
  Caddy 2.11.4 replaces the header, and adapter-node then throws "XFF_DEPTH is 2, but only found 1
  addresses". `reproduced`
- **`data-privacy.md:13-22`.** "What every deployment stores" includes audit events and solve metrics;
  the local provider uses `NoopEventSink` and `NoopSolveMetricSink`, so those are Supabase-only. The
  inventory also omits API tokens, `header-allowlist.json`, `user_profiles.recent_runs`, `last_login_at`
  and token `last_used_at`. The erasure section describes Supabase only; the local path
  (`LocalDataProvider.ts:111-135`) is undocumented. `providers/overview.md:12` repeats the first error and
  adds "identity stays in Supabase or your SSO", false for header auth.
- **`get-started/overview.md:28`** says "Selva UI Builder". The component is "UI Bridge"
  (`GH_UIBuilderComponent.cs:77`).
- **`testing.md:79`** says the plugin UI "requires a live Grasshopper WebSocket and can't run in CI".
  `packages/plugin-ui` has a Playwright suite against a WebSocket stub (`e2e/*.spec.ts`, `ws-stub.ts`).
  CI runs only `--filter=@selvajs/selva`.
- **Dangling pointers.** `.env.example:109` cites `docs/Caching.md`, `:162` cites
  `docs/security-and-limits.md`, `:305` cites `permissions.md §12` (break-glass is §2).
  ADR 0004 and 0005 line 6 cite `docs/plans/embeddable-server-layer.md`, which exists nowhere.
- **Residue from the removed header-auth fallback doc.** `.env.example:184`,
  `templates/.env.example:184` and `Caddyfile.example:17-19` say the header-auth README has "a working
  Caddyfile"; its only Caddy block is in `header-auth-entra.md:114-184`. `HeaderAuthProvider.ts:31,77`
  point at "the README's Caddy example". `header-auth/README.md:228` says "Users → New user"; the button
  is "Allowlist user".

### `docs/README.md`, `architecture.md`, `what-is-selva.md`

- `README.md:36` labels the `packages/build/` files "compute/". No such folder.
- `README.md:40-42,86` says `contributing/` is not in the site glob. `packages/website/src/lib/docs.ts:63-66`
  globs everything except `adr/**` and `README.md`. The `published` flag and the structure test keep
  those files off the site, and each gets a "not public yet" stub.
- `README.md:13-15` says internal specs are "kept next to the code rather than here" and then links
  `docs/contributing/`. `:27` files `security-and-limits`, `scaling`, `admin`, `mcp` and
  `signing-in-from-apps` under "concepts/"; they live in `deployment/` and `packages/build/`.
- `README.md:50-63` omits `diagrams.md` and `scaling-roadmap.md`, which have no inbound link anywhere.
  `selva-architecture` and `permissions` are listed twice.
- `README.md:95-96` calls `plans/README.md` authoritative for status; its line 3 says status lives on the
  issue tracker.
- `architecture.md:55` says every `@selvajs/*-provider` "runs a conformance suite". header-auth does not
  (`header-auth/README.md:119`).
- `architecture.md:44-56` and `publishing.md:9-23` omit `@selvajs/mcp` and `@selvajs/notifications`.
  Neither is `private`, and neither is in the changeset ignore list.

### ADRs

- **0001.** Written as design for `@selvajs/producers`, which was never built. The shipped design is
  `source.kind` of `user|client|server` plus an opaque `key` (`ui-schema.json:361-393`). Wrong or stale:
  - Line 10 says bare `@selvajs/ui` no longer resolves; `public.ts:71-74` and `index.ts:58-61` still
    export the four helpers.
  - Lines 19-31 and 205-211 show a `kind` enum and fields (`'external'`, `pre-step`, `producer`,
    `config`) that do not exist.
  - Lines 52, 157 and 293 describe an "External value" toggle and a `visible` line ref that do not match
    `BuilderGroupItem.svelte` and `ui-schema.json:346-350`.
  - Lines 54-55: no initial-solve timeout in `usePreviewState`; the function is `buildInitialValues`, not
    `createInitialValues`.
  - Lines 129-164: no missing-inputs panel, json-paste or `missingExternalAction` exists.
  - Line 169: `IPlatformDataStore` does not exist (`IDataProvider`); the helpers are hard-wired to
    `sessionStorage`.
- **0002.** `InboundMessageParserTests` has 33 test methods (doc: 16); `OutboundEnvelopesTests` 9 (doc: 11);
  `packages/schemas/fixtures/wire` holds 22 JSON fixtures (doc: twelve). The TS suite is
  `wire-fixtures.test.ts`, not `messageSchemas.test.ts`. `HandleMessageReceived` is at
  `WebSocketTransport.cs:563`, not 505. `FindObject`/`RefreshObjectsOnCanvas`/`ScheduleComponentExpire`
  are at `BridgeOrchestrator.cs:664-669`, not 360-367. Line 75-77 cites net48; there is no net48 target
  and the test host is net10.0. `InboundKind` has about 28 kinds, not 9. `metadata-updated.json` has no
  `_source`.
- **0003.** Status is accurate (proposed, unimplemented). Stale: every `path:line` into `+server.ts` and
  `+page.svelte` (the chain now lives in `solve/src/client/compute-fetch-solve-fn.ts:203-249` and
  `solve/src/server/response-encoding.ts:151`); `getValueByParamId` (now `getValue({byId})`); "today
  there is no response cap" (`COMPUTE_RESPONSE_MAX_BYTES` is live at 300 MB,
  `server/src/compute/limits.ts:256`); the knobs table cites `computeLimits.ts` and a ~25 MB default; the
  request cap is 256 MB, not 210 MB; the client guard is 300 MB (`ui/src/lib/constants.ts:9-10`).
- **0004.** `clientCacheKey`/`clientCache.server.ts` no longer exist and the branded `ServerIdentity` was
  removed in solve 2.0 (`client-cache.ts` keys on `server.id`; the ADR's own amendment at 80-84 says so), so lines 30-35,
  125, 144-145, 157 and 169-170 contradict it. `types.ts` anchors are `#L21`/`#L24`, not `#L18`/`#L21`.
  The route is `/api/admin/compute/status`.
- **0005.** `isUsableCachedSchema` also requires `Array.isArray(schema.inputs)`
  (`load-for-render.ts:286-287`). Lines 84-86 promise a warn log on an older-plugin schema; none exists.
  The audit link `D1` is gone from the target.
- **0006.** Line 13 names `buildContext`; it is `attachSession` into `buildRequestContext`
  (`request-context.ts:41`). `RESERVED_SLUGS` also holds `docs`, `mcp`, `oauth`
  (`organizations/schemas.ts:9-24`). "~49 internal links" is not reproducible (a rough count gave 22).
- **0007.** `IAuthProvider` has six optional sub-interfaces, not five (`interface.ts:264-296`).
- **0008.** `GH_ReportProgress.cs` exists, so "progress will too" and the "Report Progress" example
  describe a shipped component.

### `contributing/permissions.md` (46 non-confirmed)

The header says "the code conforms to this doc, not the other way around". About 40 rows below disagree
with the code. Drop the sentence.

- No platform role exists; there are five permissions (`:25,163`). `manage_instance_users` also lists,
  creates and deletes users, and disable has no enable (`:33,45,48`).
- Platform projects with grants also cross org lines (`:17`). With `ENABLE_PLATFORM_PROJECTS` off every
  rule denies a platform project, `instance_admin` included (`:265-289,330,334`).
- Bootstrap runs on every identity-provider callback, not OAuth only (`:51,55,673`); the grant uses
  `claimFirstInstanceAdmin`.
- A second owner can demote an owner; ownership transfer is an unbuilt disabled button; no revocation
  request mechanism exists (`:64-80`).
- `ALLOW_ORG_COMPUTE_OVERRIDE` gates only the org compute API and UI. Org-private server rows still
  resolve in solves with the flag off (`:83,98,116`). Resolution has a fourth step, the first visible
  server (`:119-123`). `defaultServerId` and `orgDefaults` are optional (`:140-145`).
- `public` is flag-gated, not "any authenticated user, cross-org" (`:171,213`); the flip to `public`
  needs only org owner/admin, so scenario `:776` is wrong (`guards.ts:506-515`).
- `checkOwnerRemoval` needs at least two owners before removal (`:394`) and also guards PATCH demotion
  (`:396`). `canChangeOrgRole` sits behind four handlers, not three (`:405`).
- The wrappers are in `server/src/access/guards.ts`, not `access.server.ts` (`:312`). The upload routes
  are `/api/v1/definitions` and `/api/v1/definitions/[guid]/versions` (`:359-360`).
- `/app` no longer exists; it is `/library/[guid]` (`:458,522,640,652,672`). Share tokens resolve only at
  `POST /api/v1/compute` and the `/library/[guid]` page, live channel only; `/api/v1/compute/solve` does
  not exist (`:522,784`).
- Hard-deleting a user deletes the share links they minted on both providers (`:537,742,751`). A
  `solve_count < max_solves` guard means a cap of N allows N solves, not N-1 (`:783`).
- Framework `csrf.checkOrigin` is off; Selva runs `server/src/http/csrf.ts`. No CSP `script-src` is set
  (`:554`).
- Admin pages: `/admin/orgs` is `/admin/organizations`, `/admin/update` is `/admin/system`; `/admin/audit`
  and `/admin/projects` are missing. The audit viewer is built, so `:814` is stale (`:640-664,814`).
  `/team/shares` gates on `manage_org_members`, not `manage_definitions` (`:661`).
- `DefinitionRecord` and `ProjectMember` carry no `orgId`; `ShareLink` has no audit fields (`:681-691`).
  Event names are `org_member.removed` and `project_member.removed` (`:717`).
- Flags are named `SELVA_FLAG_<NAME>` in env; the doc uses bare names without saying so.

### `contributing/selva-architecture.md`, `plugin-context.md`, `slva-format.md`

- `selva-architecture.md`: the plugin also signs in and uploads over Selva's API (`SelvaUploadService.cs`),
  so ":23-24 only through the schema and the .gh file" is too strong. `DefinitionStatus` has a fourth
  value `archived` (`:132`); the field is `solveCount`, not `runCount` (`:134`); `Invite` has `tokenHash`
  and the store has `getByTokenHash` (`:167-169`). Definitions, versions and share links reach their org
  through the project, not an `org_id` (`:69`). `generate:ts`/`generate:cs` live in
  `packages/schemas/package.json`; from the root only `pnpm generate` exists, and the doc does not say to
  `cd` (`:274-278`). The diagram omits `Plugin/Selva.Schema/Constants/SchemaVersion.cs`. The request flow
  omits the API-token branch of `hooks.server.ts` (`:240-251`).
- `plugin-context.md`: 15 of 16 line-pinned links have drifted (for example the scaffold nickname write is
  `GH_UIBuilderComponent.cs:878`, not `:624`; `FindWiredContextBake` is `BridgeOrchestrator.cs:687-718`).
  Link by symbol. The fixture has 23 objects (20 excluding groups). The quoted "Context Bake wiring"
  text exists only in this doc. With a non-schema goo the plugin falls back to the embedded schema before
  the blank default (`BridgeOrchestrator.cs:470`). PascalCase `paramType` fails at
  `ValueApplicator.cs:301-317` with "Unsupported parameter type" and a posted warning, not silently.
  `MergePostSolveBakeOutputs` only seeds a nickname on new outputs. `Debug.WriteLine` is compiled out of
  Release builds. Only `Dynamic Value List`, `FileData` and `Plotly Figure` are string-matched in the
  plugin.
- `slva-format.md:77` says `sourceComponentId` is in `EXTN "selva.gh"`; that extension carries only
  curves, and identity is the `id` attribute in TABL. `:79` says Display From File restamps EXTN; it does
  not. `:89` says large file outputs stream out of band; ADR 0003 is unimplemented. `:124` and
  `caching.md:37` say nothing caches across solves; `finished-cache.ts` keeps a 256 MB geometry cache and
  `render/edges/extraction.ts` keeps edge results in a `WeakMap`. Draw calls are materials by layers
  (`merge.ts`), not materials. Only the C# `SlvmFile` reads DMF1.

### Other `contributing/` docs

- `design-system.md:65`: tab-list and segmented tracks use `rounded-md`, not `rounded-lg`.
  `shadcn/no-unknown-classes` is an error in ui, plugin-ui and selva, a warning elsewhere (`:90-91`). Card
  primitives default to 24 px, not the 16/12 in the spacing table (`:74-82`).
- `diagrams.md:27`: column labels are 13 px, not 14.
- `drawing-backlog.md:23-30`: item 1 is shipped (zero-width strokes are invisible, no stroke without a
  style). `:35` cites `GH_RenderSvg.cs:71`, not 70.
- `materials-plan.md`: 15 presets, not 11 (`:93-105`); procedural wood, concrete, plaster, brick and
  corten ship (`:120-122`); the metal envMap is a custom studio probe, not `RoomEnvironment`
  (`:128-129`); "steps 1-5 built" refers to steps the doc never defines (`:3`).
- `publishing.md`: three of 13 published packages lack `prepack: publint` (`:38`); the version PR is
  titled "chore: version packages" (`:44`); `release-plugin.js` also rolls `[Unreleased]` in the plugin
  changelog and commits it (`:72`).
- `scaling-roadmap.md`: "everything is unbuilt" ignores the dormant `solveCacheLimit` and
  `ISolveResultCache`; storage has no presigned-upload API; dropping base64 saves 25% of wire size, not
  33%; the FIFO is `SolveQueue` in `scheduler/solve-scheduler.ts`; `:21-23` of this doc is cited as
  present tense for a `file-ref` flow ADR 0003 has not built.
- `schema-caching.md:38-46`: one `BRIDGE` marker (`solve.server.ts:359`), not two; its removal date
  (~2026-09) is past; "drop the render path's live-fetch fallback" is impossible because the same path
  re-extracts on a `schemaVersion` mismatch (`load-for-render.ts:185-195`).
- `testing.md`: only `providers/supabase` sets `fileParallelism: false`; selva runs `pool: 'forks'` in
  parallel (`:56-58`). In `playwright.config.ts` only `authed` depends on `setup` (`:85`). The base config
  also excludes `**/.svelte-kit/**` (`:42-46`).
- `turborepo.md:26`: `docs/**` is an input of `@selvajs/website#build`, not a global dependency.
- `viewer-apps.md`: `addUserGeometry` and friends already request a render, so `invalidate()` is needed
  only after a direct `scene.add` or buffer edit (`:17-20,42-43,172-173`). `clearScene` removes everything
  that is not a light or host-owned, tagged or not (`:47-48`). A named object keys on name plus layer
  before the uuid (`:62-63`).
- `compute-contributing.md:47`: an unknown `paramType` throws a `VALIDATION_ERROR` into `parseErrors` and
  then takes the Geometry fallback.

### `packages/build/` and `get-started/`

- `errors.md:32-51` lists 18 of 23 `ErrorCodes`; missing `BROWSER_ONLY`, `ENVIRONMENT_ERROR`,
  `ENCODING_ERROR`, `MALFORMED_DEFAULT`, `DEFINITION_NOT_CACHED`. `errors.md:40` and `common-tasks.md:51`
  say `timeoutMs: 0` means no limit; on Node, undici stops waiting for headers at 300 s regardless.
- `common-tasks.md:30` accesses `err.code` on an `unknown` catch variable, which fails to compile under
  strict TS. `:116` says only the first solve calls `load()`; it runs again after server eviction.
  `:133` uses an undeclared `processor`.
- `how-it-works.md:38`: `getIO` takes a URL or bytes, not a `DefinitionRef`.
- `mcp.md:40-41`: `detail: 'full'` returns geometry and file contents; `API_TOKENS_UNAVAILABLE` also fires
  when `SELVA_HMAC_KEY` is missing or under 32 characters, or the Supabase delegated session is unhealthy.
- `build/overview.md:33`: `@selvajs/ui` peers also include compute, kit, bits-ui, svelte and
  tailwind-variants. `:29`'s `compute --> schemas` edge has no dependency behind it.
- `cli.md`: `setup-proxy --domain`/`--acme-email` and `help`/`--version` are missing (`:44`); `--yes` reads
  `SELVA_*_PROVIDER`, `ORIGIN`, `SUPABASE_*` and fails on a missing required one (`:22`);
  `ALLOW_INSECURE_COOKIES` and `SELVA_CONFIG_PATH` are read in code and absent from `.env.example`
  (`:26`, `quick-start.md:34`, `reproduced`); rotating the HMAC key also invalidates every API token,
  plugin sign-in and MCP connection (`:56`); `selva` is not on PATH, use `npx selva` (`:11`).
- `quick-start.md:26`: only some `@selvajs/*` packages resolve from source; compute, solve and
  visualization come from `dist/`.
- `rhino-compute.md:25`: on the `8.x.selva` branch `CreateHeadlessDoc` already defaults to true; it is
  needed only on `9.x.selva`. `:26` `RHINO_COMPUTE_ABORT_ON_HANGUP` is not found in the fork's config or
  proxy code (`unverified`, see above).

### Self-hosting docs

- `caching.md`: remote-definition bytes live in a separate 50-entry map outside the byte budget, so
  `COMPUTE_DEFINITION_CACHE_MB=0` does not disable them (`:106-111`). The gzip copy kept beside each
  result is uncounted (`:94-95`). `cachesolve` never caches errors and has no opt-in, but Selva's own
  solve cache caches errored responses by default (`:131`). Compute solve results are memory-only per
  child (`:128`). S3 appears only in an interface comment (`:99`). `rhino_cache;dur=1` in
  `Server-Timing` is the cache-hit signal (`:219`).
- `permissions.md` (self-hosting): disable is one way (`:48`); invites can carry platform and org
  permissions (`:38-39,107`); an existing account must sign in as the invited email (`:104`); deleting an
  org also soft-deletes definitions and hard-deletes API tokens (`:75-76`); `instance_admin` does pass
  view, solve and edit on platform projects (`:56-58`); "erases their data everywhere" overclaims since
  created content stays with a null owner (`:26`). `:131-132` says users create orgs; only instance
  admins do (`routes/setup`, `api/admin/orgs`).
- `admin.md`: "all traffic" redirects to setup only for non-public pages and returns 503 `SETUP_REQUIRED`
  for `/api` (`:29`); the System nav link needs `manage_updates` (`:21`); bootstrap matches `email ?? upn`
  (`:32`); the health check also covers API-token sessions and proxy/body-limit config (`:63`).
- `scaling.md`: a compute pin is optional (`:26`). A second instance also breaks live solve events
  (`bus.server.ts` is in-process and needs sticky sessions) and compute idempotency (`:59-61`).
- `security-and-limits.md`: login is limited per IP and per account (20 per 15 min); OAuth and MCP
  endpoints per IP (30 per min) (`:36`). Compute server URLs are validated on save; link-local refused
  (`:69`). Rotation blast radius includes API tokens, MCP clients and solve-event tokens (`:87,94-102`).
- `Caddyfile.example`: `/assets/*` matches nothing; assets are under `/_app/immutable`, which the app
  already marks immutable (`:34-35`). A `www.app.` redirect is the case `caddyfile.js:23-26` avoids
  (`:49-52`).

### Providers

- `header-auth-entra.md:10`, `overview.md:22`: "pair with Supabase for data" and "mix providers freely".
  Header-auth sessions carry `sessionToken ''`, so Supabase data runs as the anon client, and
  header-auth has no `delegatedSession`. Likely RLS-denied reads and no API tokens. `UNSURE`, verify
  live.
- `header-auth-entra.md:47`: the advisory covers credential logging; "keeps a session after a failed
  refresh" needs its own source. `:203`: `doctor` warns on the header mix this line recommends
  (`checks/config.js:133-143`). `:205`: `~/selva` should be the deployment directory. `:229`: MCP clients
  cache the tool list for up to 60 s, but every call is refused at once.
- `local.md:16` claims MFA; there is none. `:24` DATA_PATH has no code default; the CLI scaffolds
  `./.selva-data`.
- `overview.md:12,18`: header-auth stores UPN, email and display name in `header-allowlist.json`;
  `IDataProvider` also holds `platformProjectGrants`, `apiTokens` and `auditQuery`.
- `supabase.md`: the CLI neither "starts the app" (`:30`) nor runs "schema first, then scaffold" (`:32`);
  the scaffold also writes `ecosystem.config.cjs` and `package.json` and runs `npm install` (`:56`);
  `sync-migrations` prints one line only for copied or conflicting files (`:70`); `doctor` does not check
  storage buckets, so it cannot confirm step 4 (`:175`); a wrong `ORIGIN` gives a 403 on form posts and
  bad callback URLs, not lost cookies (`:177`); the "Invite user" template edit may be needless because
  Selva mints its own invites (`:156`).
- `writing-a-provider.md:15`: with `SELVA_CONFIG_PATH`, `SELVA_TENANCY`, `SELVA_FLAG_*` and `SELVA_BRAND_*`
  are ignored unless the config reads them.

## 2. Confirmed

- `what-is-selva.md`: 14 of 14. `prerequisites.md`: 15 of 15. `data-trees.md`, `night-scenes.md`,
  `signing-in-from-apps.md`: no discrepancies.
- Every markdown link and anchor under `docs/` resolves except the two dangling `plans/` pointers above.
  `/diagrams/data-tree.svg` resolves to `packages/website/static/diagrams/`; `.e2e` and `e2e/.auth` are
  gitignored generated directories.
- Every import path in the `packages/build` samples resolves against the `exports` maps (compute
  `./grasshopper` and `./core`; visualization `./parse`, `./render`, `./scene`).
- Every `selva` command, flag and alias in `cli.md` matches `packages/cli/src`, apart from the missing
  `setup-proxy` flags. Ports 8765, 5173 (plugin-ui), 3000 and the 127.0.0.1 header-auth bind match code.
- `slva-format.md` matches both codecs on magics, SLVM version 3, header layout, the eight chunk fourccs,
  TABL columns, the float32 and UV fallbacks and the planar thresholds.
- The ADR status claims (0001 not shipped as designed, 0002 PR 2 absent, 0003 unimplemented,
  `COMPUTE_INLINE_FILE_MAX_BYTES` and `COMPUTE_STAGING_TTL_MS` absent) are accurate.
- Env vars in docs with no code hit are placeholders (`CLIENT_ID`, `TENANT_ID`), external Rhino variables
  or documented removals. The 23 `.env.example` variables no doc mentions are not a gap:
  `.env.example` is the authority and the docs link to it.

## 3. Paragraphs that do not earn their place

Reason codes: DUP (stated elsewhere), HISTORY (narrates past work), PLAN-POINTER, RESTATES-CODE, STALE
(already wrong), OBVIOUS, FILLER. Line counts are the agents' estimates. Items marked "wrong" in section 1
are cheaper to delete than to fix.

### Whole-file calls

- **ADR 0001, about 410 of 478 lines.** Keep the status box, the two-layer rule (`:80-85`), "object, not
  boolean" (`:31`), and a short account of the shipped `client` kind plus `key`. Cut the
  `@selvajs/producers` design (`:199-328`, 130), the line-drawer recipe (`:74-179`, 100), the producer
  walkthrough (`:378-441`, 64), the runtime-loading options (`:341-376`, 36), open questions and TL;DR
  (`:459-478`, 20), the other-repo comparison (`:443-457`, 15), and the UI-change table (`:330-339`, 10).
- **`contributing/permissions.md`, about 265 of 839 lines (32%).** Keep section numbers and headings:
  code and docs cite §2 to §12, and `conformance.test.ts:575-577` parses the §8 row prefix
  `| `/api/...`|`METHOD` |`. Cut §11 scenarios to about 8 rows (-38; three are wrong and
  `scenarios.test.ts` mirrors each by title), the `rules.ts` pseudo-code bodies in §5 (-38), the grant
  block and pseudo-code in §4a (-34), the compute type and resolution blocks (-33), the share-link data
  model and cascade (-28), the §9 route gate tables (-22), the §10 field lists (-18), and the §12 SaaS
  wishlist (-13).
- **`scaling-roadmap.md`: move to `plans/features/`.** It is unbuilt reasoning, not linked from the docs
  index, and its phase table (`:163-174`) is status. Reconcile with
  `plans/features/cloud-binary-transport.md` and `plans/fixes/data-access-efficiency-audit.md` §B, which
  cover the same ground.
- **`drawing-backlog.md`: retire.** Item 1 is shipped, items 2-4 are backlog and none is filed. Issues own
  the backlog (`plans/CONVENTIONS.md`).
- **`materials-plan.md`: keep, reshape, about 60 of 154 lines.** It describes current behaviour with
  reasons, so rename it (it is not a plan). Drop the status line, "What was wrong" (`:13-23`), the
  Before/Now table (`:54-62`), the preset table (`:93-105`, 15 presets in code) and the open items.
- **`design-system.md`: no cuts**, only the two corrections above.

### Largest cuts elsewhere

- ADR 0002: PR 1 steps shipped (`:186-207`, 16), the ASCII diagram (`:89-107`, 15), the TL;DR (`:239-250`,
  12), the stale status blocks (`:3-17`, 10).
- ADR 0003: the PR plan (`:198-210`, 11), the knobs table (`:165-174`, 10), the first blockquote
  (`:3-19`, 8), the duplicated references (`:212-218`, 6).
- ADR 0004: the checklist and TL;DR (`:146-173`, 24), the implementation narration (`:96-103`, 6), the
  deleted-code block (`:30-35`, 6), the tracker names (`:3-17`, 8).
- ADR 0005/0006/0007/0008: tracker pointers and restated decisions, about 8, 15, 12 and 4 lines.
- `selva-architecture.md`: §2 and §4 restate `permissions.md` §3 to §7 (`:105-126`, `:145-185`); §4 interface
  list (`:189-234`) duplicates `packages/platform/README.md`; §7 and §8 duplicate `architecture.md` and
  `quick-start.md` (`:270-296`); the request-flow list is `hooks.server.ts` (`:238-251`); field tuples
  for Org, DefinitionVersion and Invite are derivable and two are wrong.
- `plugin-context.md:305-326` (fixture defects, restates rules 2-4), `:159-187` (rows never string-matched),
  `:189-195` (the DO-NOT-RENAME text already sits in the class comments).
- `slva-format.md`: the Mermaid diagram (`:9-21`), the header diagram and chunk table (`:59-77`, copies of
  `SlvmDocument.cs`/`SlvmTable.cs` comments), the measured planar percentages (`:50-55`, copied from
  `SlvaWriter.cs`).
- `supabase.md`: the local-dev section (`:226-252`, 15, contributor-only and in `DEV-PROVIDERS.md`), the
  credential table (`:72-96`, 8), the SMTP table (`:124-131`, 7), the five-step glance (`:18-26`, 8), "when
  to use it" (`:12-16`, 5).
- `get-started/cli.md:66-78` and `prerequisites.md:42-58`: the same global-pm2 removal twice.
- `caching.md`: restated settings and tables (`:13-18`, `:142-154`, `:186-196`, `:24-27`, `:179-182`, about 30
  lines in total).
- `publishing.md:9-23` (a table that already lags `scripts/publishable-packages.mjs --list`),
  `schema-caching.md:38-46` (an overdue bridge recipe), `turborepo.md:5-32` (about 12),
  `viewer-apps.md:66-79,170-177` (about 20).
- `how-it-works.md:40-49,68-74,87,90`, `errors.md:64-71`, `common-tasks.md:70-72,118-124`: error behaviour
  and `DefinitionRef` warnings written four times across the build docs.
- `header-auth-entra.md:24-30` (a diagram restating the Caddyfile), `:211-218`, `:232`.

### Duplicated across documents

Keep the first-listed copy; the other becomes a one-line link.

1. `contributing/permissions.md` over `self-hosting/concepts/permissions.md`. They have already drifted;
   contributing is right on the platform permission count and the update right.
2. `contributing/permissions.md` over `selva-architecture.md` §2, §4, §6, §7.
3. `errors.md` over the error-behaviour text in `how-it-works.md`, `common-tasks.md` and
   `packages/compute/README.md`.
4. `security-and-limits.md#secrets` over `local.md:20-30`, `quick-start.md:34-38`, `cli.md:26,53-60`. They
   disagree: `local.md:26` says "32 bytes", `security-and-limits.md:87` says "at least 32 characters"
   (`LocalAuthProvider.ts:22` agrees with the latter).
5. `data-privacy.md` over the personal-data lines in `providers/overview.md:12`, `local.md:12`,
   `selva-architecture.md:300-307`, `admin.md:44`.
6. `architecture.md` over `publishing.md:9-21` (package roles).
7. ADR 0004 for the routing law and `security-and-limits.md:14` for "limiters multiply", over
   `scaling-roadmap.md` and `scaling.md`. `scaling-roadmap.md` names three different hash schemes
   (consistent `:51`, rendezvous `:73`, ADR `hash mod poolSize`).
8. `packages/platform/README.md` over `selva-architecture.md:189-234`, `providers/overview.md:14-32`,
   `writing-a-provider.md:12-15`.
9. `quick-start.md` over `selva-architecture.md:285-296`.
10. `header-auth-entra.md` over `signing-in-from-apps.md:65-69` (API keys bypass the proxy,
    `SIGN_IN_MAX_AGE_DAYS`).
11. `slva-format.md` for the layers and `STRUCTURE.md` for the format registry, over
    `Plugin/Selva.Slva/README.md:13-22,68-74`.
12. `testing.md` over `STRUCTURE.md:253-258`.

## 4. Missed by the docs and by any single-file reader

### High

- **First-run `/setup` is open to anyone who can reach it.** The only gate is "no instance admin exists"
  (`routes/setup/+page.server.ts:28-31,45-52`); the email is never checked against
  `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, though `prompts.js:120-125` makes the variable mandatory for
  multi-tenant, which implies a protection the password form ignores. Add to `overview.md` step 3 and
  `admin.md#first-run-setup`: finish `/setup` before the host is reachable. `read-only`
- **The scaffold binds `0.0.0.0` unless you chose header auth.** `reverse-proxy.md:56` says `ADDRESS_HEADER`
  is safe only while Selva is bound to loopback. Say to set `HOST=127.0.0.1` before `ADDRESS_HEADER`, or
  anyone reaching `:3000` picks their own rate-limit bucket. `read-only`

### Medium

- **Supabase guide is unpublished (`published: false`) but required.** `cli.md:24`, `admin.md:61` and
  `providers/overview.md:29` depend on it, and the site shows a stub. `read-only`
- **No password recovery on local/password auth.** ADR 0007 is unimplemented and admins never set
  passwords (`api/admin/users/+server.ts`). The clean recipe for a locked-out sole admin is `UNSURE`
  (`/setup` also creates an org and project in single-tenant mode). `read-only`
- **Privacy inventory is incomplete** (see section 1). `read-only`
- **The Update runner is shown to `manage_updates` holders whose run then returns 403**
  (`admin/system/+page.svelte:358` against `update/+server.ts:51,266`). A code bug that the docs paper
  over. `read-only`
- **`caddyfile.js:51-53` writes the same `256mb` value** that adapts to 256,000,000 bytes, below the 256 MiB
  caps. Uploads between about 244 MiB and 256 MiB would be rejected by Caddy first. `read-only`

### Low

- `ALLOW_INSECURE_COOKIES` and `SELVA_CONFIG_PATH` are read in code and absent from `.env.example`.
  `reproduced`
- `selva keys rotate hmac` blast radius (every API token, MCP client, solve-event token) is not in
  `keys.js` `TARGETS` or `cli.md`. `read-only`
- The in-process solve-event bus and compute idempotency store need sticky sessions on a second instance;
  `scaling.md` and `scaling-roadmap.md` name only the rate limiter and caches. `read-only`
- `docs/README.md` index, repo-wide: `STRUCTURE.md:315` sends backlogs to `docs/contributing/` while
  `docs/README.md:93-96` and `plans/CONVENTIONS.md` send them to issues. `read-only`
- `docs.ts:10` cites `docs/__tests__/structure.test.ts`; the real file is
  `packages/website/tests/docs-structure.test.ts`. `read-only`

## 5. Decisions for a human

- **ADR 0001.** Rewrite to the shipped design, or archive and replace with a short ADR. Recommend a
  rewrite to about 70 lines; the old design is already contradicted line by line.
- **Plan-like docs in `docs/`.** Recommend following `plans/CONVENTIONS.md`: retire `drawing-backlog.md`,
  move `scaling-roadmap.md` to `plans/features/`, rename `materials-plan.md`, and change
  `STRUCTURE.md:315` to match.
- **Publish `supabase.md`?** Recommend yes. Seven docs treat its steps as mandatory.
- **`contributing/permissions.md` authority.** Where doc and code differ, which wins? Recommend the code,
  with the doc corrected, except the `/admin/system` Update runner, where the UI should match the route.
- **Two permissions docs.** Recommend contributing owns rules and the self-hosting page restates only
  tables.
- **`/setup` and `HOST`.** Recommend code fixes, not only doc lines: restrict the password form to the
  bootstrap email, and scaffold `HOST=127.0.0.1` whenever the CLI sets up a proxy.
- **Apply the cuts?** Section 3 is a report. Recommend applying the corrections in section 1 first, since
  several cuts delete the wrong text outright, then trimming with `trim-docs`.

## Appendix: repros

Caddy 2.11.4:

```sh
caddy adapt --config docs/self-hosting/deployment/Caddyfile.example
# Error: Unexpected next token after '{' on same line, at cf-example:41
printf ':80 { reverse_proxy 127.0.0.1:3000 }\n' > one.cf && caddy adapt --config one.cf
# Unexpected '}' because no matching opening brace
printf ':80 {\n\treverse_proxy 127.0.0.1:3000\n}\n' > ok.cf && caddy adapt --config ok.cf   # ok
```

Magic-link template against the callback URL Selva builds:

```sh
node -e "const u=new URL('https://x/auth/email/callback?redirectTo=%2Flibrary?token_hash=pkce_abc&type=magiclink');console.log(u.searchParams.get('token_hash'),u.searchParams.get('redirectTo'))"
# null /library?token_hash=pkce_abc
```

`/setup` gate after `cli.md:101`'s recipe (run from the repo root against built `dist`):

```js
const imp = (p) => import(pathToFileURL(join('D:/Coding/selva', p)).href);
const { LocalPlatformPermissionStore } = await imp(
	'packages/providers/local/dist/permissions/LocalPlatformPermissionStore.js'
);
const { createLocalUserDataStore } = await imp('packages/providers/local/dist/data/userData.js');
const { SYSTEM_CONTEXT } = await imp('packages/platform/dist/index.js');
const dir = mkdtempSync(join(tmpdir(), 'selva-repro-'));
const userData = createLocalUserDataStore(join(dir, 'user-data.json'));
await userData.ensure('admin-1');
const store = new LocalPlatformPermissionStore(userData);
await store.set(SYSTEM_CONTEXT, 'admin-1', ['instance_admin']);
console.log(readdirSync(dir)); // user-data.json only, no auth-users.json
const fresh = LocalPlatformPermissionStore.fromEnv({ DATA_PATH: dir });
console.log(await fresh.hasInstanceAdmin(SYSTEM_CONTEXT)); // true, so /setup redirects to /login
```

Not kept as scripts: the `parse_as_bytes('Infinity')` check against adapter-node 5.5.7 (`Infinity` accepted,
`'256mb'` gives `NaN`) and the forwarded-for check behind default Caddy (sent `X-Forwarded-For: 9.9.9.9,
8.8.8.8`, backend saw `127.0.0.1`). The env-var diff is a script over `env.X` reads in
`packages/selva/src` against `.env.example`.
