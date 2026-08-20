# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Before you start

[STRUCTURE.md](./STRUCTURE.md) is authoritative for folder layout, naming, and per-package conventions. Read it before adding files.

## Never do these

Each of these is silent — nothing fails at build time, and the damage shows up later in someone else's saved file, log collector, or bundle.

- **Never change a param list on a released Grasshopper component** without the OBSOLETE + upgrader procedure below. Grasshopper binds wires by index; reusing the `ComponentGuid` with a changed param list rewires saved definitions.
- **Never log a whole domain object.** Log identifiers (`eventType`, `actorId`, `userId`), never payloads. Erasure cannot reach stdout.
- **Never add a `three` dependency to `@selvajs/compute`**, in any form, including a `/visualization` sub-export.
- **Never hand-edit generated files.** Edit `ui-schema.json` and regenerate.
- **Never hardcode a shared dep version.** Reference `catalog:` and edit `pnpm-workspace.yaml`.
- **Never describe Selva as having "zero exposure" to data-protection law.** It holds personal data; the operator is the controller.

## Project Overview

Selva is a cross-platform Rhino Grasshopper plugin with a SvelteKit web UI for building Grasshopper-driven web applications. Dual stack:

- **Backend**: C# (.NET multi-target: net48/net7.0/net9.0) — Grasshopper plugin
- **Frontend**: SvelteKit with TypeScript + Tailwind CSS
- **Communication**: WebSocket served by the plugin on loopback (8765 by default, a free port if taken) + embedded HTTP server

Monorepo: `packages/` (TypeScript/Svelte workspace) and `Plugin/` (.NET / Grasshopper). Shared dep versions are pinned in `pnpm-workspace.yaml` catalogs — reference `catalog:` in a package's `package.json` rather than hardcoding a version.

The web app runs in two modes: **Local** (`@selvajs/plugin-ui`, the drag-and-drop schema designer, embedded into `Selva.gha` and served from the plugin's local HTTP port) and **Cloud** (`@selvajs/selva`, standalone, solves through Rhino.Compute, installed via `@selvajs/cli`).

## Code Style

- Write self-documenting code. Keep it simple; avoid premature abstractions.
- Error handling only at system boundaries (user input, external APIs).
- Section headers: a title between two lines of `// ====...` (76 equals signs).
- **Route handlers parse, guard, delegate, serialize — nothing else.** A rule that
  two endpoints must agree on belongs in `$lib/server/` or `@selvajs/server`, not
  copied into both. `/api/admin/*` and `/api/v1/*` are siblings over one core, so a
  rule duplicated across them drifts silently: the compute-config apiKey merge
  (`$lib/server/compute/serverConfigWrite.ts`) clears or leaks a stored credential
  if the two copies disagree, and nothing fails at build time.

### Comments

Default to no comment. Names and types carry the WHAT; a comment exists only where a competent reader would otherwise get something **wrong**.

Write for someone reading this cold in six months, not for the reviewer watching this diff. Most bad comments are narration of work just done.

Before writing a comment explaining what a function does, check whether renaming it removes the need.

**Comment when:**

- The WHY is non-obvious: a constraint, a workaround for a specific bug, an invariant nothing enforces
- Footgun: "don't call X before Y — breaks Z"
- A suppression's reason. Never a bare `eslint-disable`, `@ts-expect-error`, `# noqa`.

**Don't:**

- Restate the line below, or re-narrate the type signature in prose
- Point at planning artifacts — spec sections, RFCs, ADRs, tickets, design docs, plan files. Keep the reason, drop the pointer:
  `// Spec §7 — share-link admin routes.` → delete
  `// Per spec §7, admin links skip the rate limiter — issued by a human, not a client.` → `// Admin links skip the rate limiter: issued by a human, not a client.`
- Narrate history: "added for X", "used by Y", "now also handles Z". Git knows.
- Leave a `TODO` without a ticket or an actionable condition

**One fact, one place.** State it at the narrowest scope that needs it — inline beats JSDoc beats file header. If the module header explains the design decision, no function in that file repeats it.

**Exception — files where the code carries no meaning.** Wire formats, bit flags, magic numbers, opcodes, crypto constants, tuned thresholds. `FLAG_HAS_UVS = 0x8` says nothing on its own; there the comment _is_ the specification. Be complete, not terse.

**Sibling declarations keep the same doc shape.** Flag bits, enum members, error codes documented as a set: one form for all of them, or the odd ones read as though they mean something different.

When editing: leave comments you didn't invalidate alone. Delete rather than comment out.

### How comments and docs should read

**Write like an engineer at a whiteboard, not like a specification.** Would you say it this way out loud to a colleague? If not, rewrite it. This applies to `.md` files too.

- _utilize_ → _use_, _leverage_ → _use_, _facilitate_ → _let_, _prior to_ → _before_, _in order to_ → _to_
- Cut throat-clearing: _It should be noted that_, _This function is designed to_. Start at the verb.
- Verbs, not nouns: _performs a validation of_ → _validates_
- Say who does what: _the buffer is detached_ → _`slice()` detaches the buffer_
- Name the thing: _the relevant data structure_ → _the vertex buffer_
- Split any sentence you'd run out of breath reading aloud

Domain terms are not jargon — _zigzag encoding_, _prefix sum_, _idempotent_ stay. Plain language, not simplified content. Neutral and human; no jokes.

> _It should be noted that invocation prior to initialization may potentially result in undefined behavior._
> → _Calling this before `init()` returns garbage — the lookup table is still empty._

The rewrite is barely shorter. It's better because it names what breaks and why.

## Architecture

### Type safety end-to-end

`packages/schemas/ui-schema.json` generates both TypeScript types for the UI and C# types for the plugin. Generated output lands in `packages/schemas/src/generated/schema.ts` and `Plugin/Selva.Schema/Models/UISchema.Generated.cs`. After editing the schema, run `pnpm generate`.

### `@selvajs/compute`

`packages/compute`, published to npm. Modular exports for tree-shaking: main (utilities and types), `/grasshopper` (Rhino Compute client, data trees, input/output parsers), `/core` (low-level fetch and error handling). Discriminated unions for type-safe error handling; browser and Node compatible.

Pure solve/data — see the `three` prohibition above. Anything that turns a response into Three.js objects, sets up a viewer, or drives a solve session belongs in `@selvajs/visualization`.

### `@selvajs/visualization`

`packages/visualization`. Framework-free (no Svelte, no runes); `three` is a peer dep. Four layers that **depend downward only**: `scene`, `render`, and `parse` are siblings — none imports another — and each may import `shared`. Each layer has its own barrel and README naming its extension points.

- `/scene` — `createSceneOutliner`: reads a scene (visibility/selection/layers), never owns content
- `/render` — `initThree` plus the CAD viewer toolkit (camera, edges, grid, gizmo, measure)
- `/parse` — backend payload → THREE meshes (`webdisplay`, `display-items`)
- `shared/` — **internal**: coordinate frame, look presets, errors, logging, geometry/color math. Not a published entrypoint; what consumers need is re-exported from `/render`.

**The public API is deliberately minimal — do not re-export a symbol just because it exists.** `initThree` owns the render toolkit and hands live instances back on `ThreeViewer`, so their factories stay unexported; `createSceneOutliner` composes the scene layer's parts; the SLVA binary wire format is private to `parseMeshBatch*`. Export handle _types_ so hosts can annotate, keep constructors internal. The root `.` entrypoint intentionally re-exports nothing — import from a layer.

**One seam must be preserved so a layer never depends upward:** `render/` takes an `onMaxAnisotropy` hook rather than calling into `parse/` (the host wires it to `setTextureAnisotropy` from `/parse`).

Two traps, both of which produce correct values that never re-render:

- In a Svelte component use `useSolveSession` from `@selvajs/ui`, not a raw solve factory.
- In markup read the injected set — `hidden.has(getTrackingKey(obj))`, not `outliner.visibility.isHidden(obj)`.

The Svelte shells stay in `@selvajs/ui`: `Viewer.svelte`, `SceneManager.svelte`, `useSolveSession.svelte.ts`, `solving.svelte.ts`, plus the design system. **Whoever owns the scene owns the outliner** — `Viewer.svelte` creates it and calls `applyTo()` after a solve; the panel only renders it.

The solve session used to be a fifth layer here; it now lives in `@selvajs/solve/client`.

### `@selvajs/platform`

Pluggable provider interfaces (auth, data stores, storage, permissions, access rules) with Zod schemas. Granular exports for tree-shaking — see [packages/platform/src/](packages/platform/src/). `@selvajs/local-provider` is the filesystem-backed implementation (HMAC sessions, atomic-write JSON, WebP image transcoding).

### Grasshopper components

[docs/contributing/plugin-context.md](./docs/contributing/plugin-context.md) is authoritative for canvas wiring and schema identity —
which ContextBake carries what, which GUID is an output's identity, why `paramType` case matters.
Read it before editing a `.ghx` or touching schema sync; every rule in it fails silently.
Component authoring is covered by video, not prose. For the display wire format, see
[docs/contributing/slva-format.md](./docs/contributing/slva-format.md).

`Plugin/Selva.GH/Features/`:

- **UIBuilder** — `GH_UIBuilderComponent`, schema linking and WebSocket communication
- **Display** — `ThreeMaterial`, 3D web visualization config
- **FileIO** — `GH_DataToFileGeneric`, `GH_BlockToFile`, geometry export
- **ComputeIO** — `GetValueListParameter`, `GH_ValueListDataGoo`, and other interactive-selection params (colors, images, files)

**Adding or removing a param on a released component is a breaking change.** Snapshot the old shape into `Features/<Name>/OBSOLETE/`, give the live component a new GUID, and add an `IGH_UpgradeObject` remapping the indices. Full procedure: [STRUCTURE.md](./STRUCTURE.md#changing-a-components-parameters-obsolete--upgrader).

### Production build

`pnpm run build:plugin` produces a **fully self-contained** `.gha`: builds `@selvajs/plugin-ui` assets → copies to `Plugin/Selva.GH/EmbeddedAssets/web/` → embeds them as `EmbeddedResource` → builds multi-target (net48 + net7.0 for Rhino 8, net9.0 for Rhino 9). No external dependencies; LocalWebServer auto-allocates an HTTP port at runtime.

## Commands

`pnpm install` first. Builds are orchestrated by Turborepo (see `docs/contributing/turborepo.md`); most scripts run through it, with the exceptions noted.

### Searching the repo

1,910 tracked files, ~70,000 in `node_modules`. Anything that walks the tree
without honouring `.gitignore` spends 97% of its time in dependencies — `grep -r`
and `du -sh .` both take minutes here and `du -sh .` will blow a 120s timeout.

```bash
rg -n "pattern" -g '*.mjs'      # honours .gitignore. ~0.1s
git grep -n "pattern" -- '*.mjs' # tracked files only — misses untracked ones
git count-objects -vH            # repo size, instant
rg -uu "pattern" packages/cli    # opt back INTO node_modules; always scope it
```

Piping to `head` or post-filtering with `grep -v node_modules` doesn't help: the
traversal has already happened by then.

```bash
pnpm dev:plugin             # plugin-ui dev server (http://localhost:5173)
pnpm dev:selva              # Selva app, your own .env and .selva-data

# Same app pinned to one auth provider, each on throwaway data —
# for testing provider behaviour, not for daily work. scripts/DEV-PROVIDERS.md
pnpm dev:local              # local provider (filesystem + password)
pnpm dev:supabase           # Supabase CLI stack (Docker)
pnpm dev:header             # forward-auth, the path Entra reaches (Caddy)

pnpm build                  # every package in dep order, cached
pnpm build --filter=@selvajs/selva
pnpm run build:plugin       # production .gha with embedded web assets

pnpm check                  # svelte-check
pnpm type-check             # tsc --noEmit
pnpm lint                   # ESLint — repo root, NOT via turbo
pnpm format                 # Prettier
pnpm test                   # vitest across packages that have tests
pnpm generate               # regenerate TS + C# from ui-schema.json

pnpm clean                  # remove node_modules, .svelte-kit, pnpm-lock.yaml
pnpm rebuild                # clean + install + build
```

Single package: `cd packages/<name> && pnpm test` (or `pnpm test:watch`).

.NET: `cd Plugin && dotnet build` (add `--configuration Release`), `dotnet test`, `dotnet test --filter "FullyQualifiedName~SchemaMigrator"`.

### Before calling work done

```bash
pnpm type-check && pnpm lint && pnpm test
```

Plus `cd Plugin && dotnet build && dotnet test` if C# changed, and `pnpm generate` if `ui-schema.json` changed.

### Local development

Two terminals: `pnpm dev:plugin` (web on :5173), and `cd Plugin && dotnet build` then run in your IDE. The plugin opens the dev-server URL with its own `wsPort` in the query string, and the page connects back over WebSocket — hot reload on web changes while the plugin stays debuggable.

### Installing to Grasshopper

```bash
# Windows (Rhino 8)
copy "Plugin\bin\Release\net7.0\Selva.gha" "%APPDATA%\Grasshopper\Libraries-8\"

# macOS (Rhino 8)
cp Plugin/bin/Release/net7.0/Selva.gha ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/
```

Restart Rhino completely afterwards.

## Data privacy

**Selva minimizes the personal data it holds, but it does hold some — and the operator is the data controller**, responsible for residency, retention, and erasure requests.

Stored in every deployment:

- Opaque session tokens (cookies)
- User id + permissions
- Display names (`user_profiles.display_name`)
- Invite email addresses (`invites.email`) — retained after accept or expiry
- Audit-event payloads (`audit_events.data`), which embed an email for `invite.created` (see the `DomainEvent` union in `packages/platform/src/events/interface.ts`)
- Solve telemetry (`solve_metrics`), keyed by `actor_id` and deliberately **not** FK-cascaded, so it survives deletion of the definition or user it refers to

Login IPs are processed by the rate limiter but stay in memory, expire within the rate-limit window, and are never persisted.

How much the auth provider owns depends on which one runs:

- **Supabase** — credentials and identity live in Supabase `auth.users`; Selva holds only the authorization data above. This is the case the "provider owns it" framing describes.
- **Local** — **Selva _is_ the auth provider.** `auth-users.json` holds email addresses and PBKDF2 password hashes on the deployment's own disk (`packages/providers/local/src/auth/users.ts`). No third party, no credential-isolation claim.

**Erasure.** `SupabaseDataProvider.onUserDeleted(ctx, userId, { email })` scrubs what FK cascade doesn't reach: deletes `audit_events` the user authored (keyed by plain-text `actor_id`) and `invites` addressed to their email, redacts that email from surviving `invite.created` payloads (`redact_audit_event_email`), and tombstones `solve_metrics.actor_id` to `'deleted'` so the row survives for capacity aggregates while the person does not. The admin delete handler captures the email before `deleteUser` and passes it through. **Open gap:** no time-based retention on `audit_events` or `solve_metrics` — rows live until a subject is erased.

**Logs are the escape hatch erasure cannot follow.** `onUserDeleted` scrubs rows; it has no reach into stdout, which on a real deployment has already shipped to a collector and may be indexed by a third party. A log line carrying personal data outlives every guarantee above — hence the prohibition on logging domain objects. The pino redaction list (`packages/server/src/logging/PinoLogger.ts`) scrubs by **credential field name** (`token`, `apiKey`, …) and will NOT catch an email nested in a payload; it is a backstop for accidents, not a licence to log objects.

## Environment variables

[packages/selva/.env.example](packages/selva/.env.example) is authoritative — every var the Selva app reads is documented inline there. Don't duplicate it here or in provider READMEs; link to it.

The plugin UI needs none (WebSocket port comes from the `wsPort` query param, 8765 by default). Rhino.Compute server URL and API key are configured at `/admin/compute` and persisted via `IComputeServerStore`, not env vars.

## Requirements

- [pnpm](https://pnpm.io) >= 11.0.0 (pinned in `packageManager`, activated via Corepack)
- Node.js >= 24.0.0
- .NET SDK 7.0+ (plugin development)
- Rhino 8 or 9 — Rhino 7 is not supported
- Rhino.Compute: the [VektorNode fork](https://github.com/VektorNode/compute.rhino3d) is required for block instance support

## Issues

Use the templates in [.github/ISSUE_TEMPLATE/](./.github/ISSUE_TEMPLATE/).
