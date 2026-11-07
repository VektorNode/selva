# `@selvajs/platform` review: what is left

> **Tracked in:** unfiled. Review of `packages/platform`. Findings already fixed are removed from
> this document; `git log -p packages/platform` shows them. Everything below is unfiled.

## Ground rules

- `@selvajs/platform` is published at 1.0.0. An external consumer imports about 55 symbols from
  `.`, `./config` and `./definitions`. Removing or renaming a public export is a major bump.
- The conformance kit (`./testing`) is public API too: a new ungated case can turn a third-party
  adapter red, so stricter cases sit behind opt-in options until a major flips the defaults.

## For the next major

Each of these breaks a public type or export, so they ship together.

- **Request bodies and the v1 DTO move to `@selvajs/server`.** `CreateDefinitionInputSchema`,
  `UpdateMetadataInputSchema`, `PublishVersionInputSchema`, `CreateShareLinkInputSchema`,
  `CreateOrgSchema`, `UpdateOrgSchema`, `DefinitionListItem` and `toDefinitionListItem`. Server
  already re-exports the three JSON bodies under `*BodySchema` names, so the move only changes
  where they are declared. Platform keeps `GuidSchema`, `SlugSchema` and the enums. Drop
  `solveCacheLimit` from the PATCH body and `DefinitionRecord` at the same time: nothing reads it.
  The external consumer imports `CreateDefinitionInputSchema`, so one import line changes there.
- **Remove the binding seam and the `server` input kind**, with a schema migrator. No fixture,
  example or saved definition in the repo uses the kind (all `.gh` and `.ghx` files checked), and
  the solve path already refuses a posted value for it. The alternative is wiring a resolver, which
  nobody has asked for.
- **Remove** `withAdminBypass`, `ProjectAccessInput.orgPermissions`, the `system` field on
  `actorFrom`/`actorOf`, and `SolveMetric.ok` (it always equals `failureKind === 'ok'`; the
  shipped `solveMetricSinkSuite` and the consumer's object literal change with it).
- **Flip the kit defaults**: non-admin ctx and status-code denials on by default.
- **`ShareLink.expiresAt/revokedAt/maxSolves`** become `T | null`, not optional-and-nullable.
- **Peer ranges** `sharp ^0.34 || ^0.35` and `vitest ^3 || ^4 || ^5` claim versions CI never
  runs. Narrow them, or keep them and add a CI matrix.

## Decisions still open

- **SVG uploads.** The transcoder now refuses filters, masks, markers, nested `<use>`,
  `stroke-dasharray`, `data:` URLs and entities, because librsvg ignores sharp's timeout for each
  of them. That list was built by measurement, not from a spec, so another construct may still
  hold a slot. It also refuses many Figma and Inkscape exports. The bounded alternatives are
  rasterising SVG in a child process that can be killed, or not accepting SVG uploads at all.
- **Share-link quota on a refused solve.** A share-link solve refused for posting a value to a
  `server`-kind input is still charged: the check runs after the schema backfill, which runs after
  the share-cap increment.

## Not yet verified

- **The Supabase live suite.** It needs Selva's own local stack (`.env.test` in
  `packages/providers/supabase`). After running it, opt the Supabase conformance tests into the kit
  options it passes: `limitClamp` and `silentNoops` should now pass, and probably
  `refusesEscalation`, `orgScopedReads`, `publicListing`, `segmentPrefix`, `revokeAccepted`,
  `revocationState` and `strictDenials` on storage.
- **The external consumer**, built against the changed package.

## Smaller items

- **Node-environment tests import workspace packages from `dist/`**, not source:
  `packages/config/vitest.config.js` sets `resolve.conditions` only, and no package sets
  `ssr.resolve.conditions`. A change to platform is invisible to provider and server tests until
  platform is rebuilt. Adding `ssr.resolve.conditions: ['selva-source', ...]` would fix it, but it
  changes what every node test resolves.
- `auth/interface.ts`: `getOAuthAuthorizationUrl` takes `'google'|'github'|'azure'|'gitlab'` while
  `listProviders()` returns `readonly string[]`; Supabase repeats the union.
- `config/resolve.ts`: `KeyReport.value` and `ResolvedConfig.values` are `unknown`, so every reader
  casts.
- `packages/server/src/api/responses-schema.ts`: `ShareLinkResponseSchema` re-lists every
  `ShareLink` field by hand.
- `packages/compute/src/core/server/validate-server-url.ts` keeps its own `trimTrailing`: compute
  cannot depend on platform.
- `tsconfig.json` compiles tests into `dist` and `files` filters them out: wasted work only.
- The provider packages have no `lint` script, so turbo never lints them.
- Optional: kebab-case `storage/assetClasses.ts`, `cacheBust.ts`, `safeKey.ts` and the suite files.
  Folder names stay: they are the subpath names.

## Considered and left

- Moving `config/report` and `config/snapshot` to server: the consumer imports
  `buildConfigReport`, `ConfigReport` and `ReportRow`; a major for little gain.
- Removing the unused kit options (`singleOrgMode`, `seedProject`, `cleanup`, `userManagement`):
  hooks for third-party adapters; a major for no gain.
- The `canEditProjectSettings` alias: six importers, a separate decision.
- Splitting `auth/interface.ts`: six capability interfaces plus `IAuthProvider`, already short.
- Splitting `access/rules.ts`: about 290 lines after the gate refactor, and `canReclaim` and
  `canChangeVisibilityToPublic` straddle project and org.
- Renaming camelCase folders: they are the published subpaths.
- `readonly` permission arrays on `RequestContext`: breaks readers that assign them to mutable
  types (`selva/src/routes/admin/+page.server.ts`).
- Keeping `main` and top-level `types`: they help only node10 resolution of `.`; harmless.
