# Plugin ↔ app compatibility gate — plan

> **Status: PLANNING (2026-07-22).** Design only — no implementation yet.
>
> Problem: when the Selva plugin on a Rhino.Compute server and the `@selvajs/*`
> packages in the deployed app drift apart (e.g. the plugin starts emitting SLVA
> mesh format v4 while `@selvajs/compute` parses ≤ v3), the mismatch is only
> discovered **mid-solve**, as a parser exception or Zod failure with no
> actionable message. This plan adds a declared compatibility contract and
> enforces it at three points, earliest first, so incompatibility is a clear
> admin-visible verdict instead of a runtime blow-up.

---

## Current state (verified 2026-07-22)

Four versioning axes exist; none are tied together before a solve.

| Axis                                                 | Source of truth                                                                                     | Consumers / gates today                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **UI schema format** (`schemaVersion`, `2.12.0`)     | `packages/schemas/ui-schema.json` default                                                           | C#: `SchemaMigrator` migrates older, `ValidateCompatibility` rejects newer **major** only (`SchemaMigrator.cs:540-578`). TS: `assertSupportedSchemaVersion` rejects **any newer** semver (`packages/server/src/definitions/schema-extraction.ts:37-56`).                                                                             |
| **Plugin version** (assembly version, e.g. `0.15.4`) | `Plugin` assembly                                                                                   | Stamped into the schema (`pluginVersion`, `minPluginVersion`); `minPluginVersion` enforced only C#-side on `.gh` load (`SchemaMigrator.cs:410`). Never checked in TS; not in any WS or compute envelope.                                                                                                                             |
| **SLVA binary mesh format** (v3, min supported v1)   | duplicated by hand: C# `BinaryGeometryWriter.cs:72` (`Version = 3`) and TS `binary-parser.ts:24,31` | Parser throws `Unsupported SLVA version` mid-solve (`binary-parser.ts:182-197`). No pre-solve negotiation; no guard keeping the two constants in sync.                                                                                                                                                                               |
| **Compute server / installed plugin inventory**      | Rhino.Compute `/version`, `/plugins/gh/installed`                                                   | Queried by `ComputeServerStats.getVersion()` / `getInstalledPlugins()` (`packages/compute/src/core/server/compute-server-stats.ts:184-262`); surfaced **display-only** in the admin status route (`packages/selva/src/routes/admin/api/compute/status/+server.ts:43-76`, extracts `selvaVersion`). The solve path never looks at it. |

Already solved (don't re-plan): the `schemaVersion` constant is **not**
triplicated — `generate-csharp.js:778-806` regenerates
`Plugin/Selva.Schema/Constants/SchemaVersion.cs` from the JSON default, and both
codegen scripts hard-fail if schema definitions change without a version bump
(`checkSchemaVersionBumped`). JSON ↔ TS ↔ C# schema version cannot silently
drift. The **SLVA version pair has no such guard** — that's a real gap.

### Where a mismatch surfaces today

1. **Upload/extraction** — a schema authored by a _newer_ plugin is rejected
   with a good message (`SchemaExtractionError('unsupported')`). ✅ works.
2. **Solve** — mesh blobs from a newer plugin die in `parseBinaryMeshBatch`
   with `Unsupported SLVA version 4`; other shape drift dies in Zod/parse
   errors. ❌ raw exception, no guidance, no admin visibility.
3. **Admin UI** — shows `selvaVersion` per server but renders a green "online"
   even when that version is incompatible. ❌ no verdict.

---

## Design

### Unified policy (decide once, apply everywhere)

**A consumer rejects anything newer than itself; producers always emit their
current version; older input is migrated (C#) or accepted (TS).**

Concretely:

- TS keeps its existing strict rule (any newer `schemaVersion` → reject) — the
  renderer cannot know constructs it wasn't built with.
- C# `ValidateCompatibility` tightens from "newer major" to "any newer
  `schemaVersion`" to match. Pre-release, versions move in lockstep; the looser
  rule only hides drift.
- SLVA: parser keeps `[MIN_SUPPORTED_VERSION .. BINARY_MESH_VERSION]`; a writer
  above the parser's max is _incompatible_, full stop (no dual-format emit —
  see non-goals).

### 1. Compatibility contract (`@selvajs/compute`)

New module `packages/compute/src/core/server/compatibility.ts` exporting a
single declared contract plus a version→capability table:

```ts
export const COMPAT = {
	/** Schema format this app renders (from @selvajs/schemas). */
	schemaVersion: UI_SCHEMA_VERSION,
	/** SLVA range this app parses (re-exported from binary-parser). */
	meshFormat: { min: MIN_SUPPORTED_VERSION, max: BINARY_MESH_VERSION },
	/** Oldest plugin whose output this app fully supports. */
	minPluginVersion: '0.15.0',
	/** Newest plugin this app has been tested against (informational). */
	maxTestedPluginVersion: '0.15.x'
} as const;

/** What a given plugin version emits. Rows added per plugin release. */
const PLUGIN_CAPABILITIES: Array<{
	range: string; // semver range, e.g. '>=0.14.0 <0.16.0'
	meshFormatVersion: number; // SLVA version that plugin's writer emits
	schemaVersion: string; // schema format that plugin emits
}> = [{ range: '>=0.14.0', meshFormatVersion: 3, schemaVersion: '2.12.0' }];
```

The table is the piece that turns "plugin 0.16.0 installed" into "that plugin
emits SLVA v4, this app parses ≤ v3" **before** any solve. It starts with one
row; each plugin release that changes a wire format adds one. Unknown-but-newer
plugin versions (no matching row) degrade to a _warning_ verdict, not a hard
block — the table can lag a release without bricking solves.

No new semver dependency: the repo has no `semver` package in
`@selvajs/compute`; reuse/extend the tiny `parseSemver` from
`schema-extraction.ts` (move it into the compat module and re-export).

### 2. `checkServerCompatibility()` (`@selvajs/compute`)

Same module, built on the probes `ComputeServerStats` already has:

```ts
export type CompatVerdict =
	| { status: 'compatible'; pluginVersion: string }
	| { status: 'plugin-missing' }
	| { status: 'plugin-too-old'; pluginVersion: string; required: string }
	| { status: 'plugin-too-new'; pluginVersion: string; detail: string } // e.g. mesh v4 > max v3
	| { status: 'unknown'; pluginVersion: string } // newer than table, warn only
	| { status: 'unreachable' };

export async function checkServerCompatibility(stats: ComputeServerStats): Promise<CompatVerdict>;
```

Logic: `getInstalledPlugins('gh')` → `Selva` version → compare against
`COMPAT.minPluginVersion`, then look up `PLUGIN_CAPABILITIES` and compare the
row's `meshFormatVersion`/`schemaVersion` against what this app supports.
Respect the existing "inventory still loading" semantics from the status route
(empty/null plugin map → not a verdict, report unreachable/not-ready, caller
retries).

### 3. Three enforcement points

**Gate A — admin status (earliest, cheapest).**
`admin/api/compute/status/+server.ts` calls `checkServerCompatibility` (it
already has the `stats` instance and the plugin map — pass the map in to avoid
a second fetch) and adds `compat: CompatVerdict` to its JSON. The admin compute
page renders it: red badge + verdict message for incompatible, amber for
`unknown`, instead of an unconditional green "online". No persistence in
`IComputeServerStore` — the verdict is a live property of the server, recomputed
per probe.

**Gate B — definition upload/extraction.**
`schema-extraction.ts` already gates `schemaVersion`. Two additions:

- After extraction, if `schema.minPluginVersion` is set and the _serving
  server's_ Selva version is known (one `getInstalledPlugins` call, cacheable),
  reject with a clear message when the server's plugin is older than the schema
  requires. (C# enforces this on the compute box, but in a multi-server config
  the _other_ servers may be older — checking here catches that at upload
  instead of at the first solve routed to the old server.)
- Move `parseSemver` + the compare helper into the compat module so B and the
  C#-mirroring rule share one implementation.

**Gate C — solve path (backstop + cached pre-check).**

- _Cached pre-check:_ where the compute client is constructed per server
  (`packages/server/src/compute/client-cache.ts`), run
  `checkServerCompatibility` once per server per TTL (~5 min, in-memory beside
  the client cache). Hard-fail fast on `plugin-missing` / `plugin-too-old` /
  `plugin-too-new`; log-and-continue on `unknown`. This is what actually stops
  the "fails only when solving" experience for the mesh-version case.
- _Error mapping:_ wrap the SLVA parse site so `Unsupported SLVA version N`
  (and the schema-Zod failures on solve output) surface as a typed
  `RhinoComputeError` with `ErrorCodes.INCOMPATIBLE_PLUGIN` (new code) and a
  message naming both versions and the fix ("compute server runs Selva plugin
  X emitting mesh format N; this app supports ≤ M — update @selvajs packages
  or install plugin ≤ Y"). The solve route maps it to a 4xx/5xx the UI can
  show verbatim.

### 4. Close the SLVA duplication gap

The two hand-maintained constants (`BinaryGeometryWriter.Version` and
`BINARY_MESH_VERSION`) get a single source: add a `wire-format.json` to
`packages/schemas` (`{ "slva": { "version": 3, "minSupported": 1 } }`) and have
both codegen scripts emit the constants (TS const + a small generated C#
`WireFormat` class), same pattern as `SchemaVersion.cs`. The existing
bump-guard machinery extends to it. Cheaper alternative if codegen feels heavy:
a C# unit test + a vitest each pinning the value with a cross-referencing
comment — but codegen is preferred since the pattern already exists.

### 5. Align C# `ValidateCompatibility`

Change `SchemaMigrator.ValidateCompatibility` to reject any newer
`schemaVersion` (not just newer major), mirroring TS. Update its tests.

---

## Work items

Ordered; 1–3 are the core, 4–6 finish the job.

1. **Compat module in `@selvajs/compute`** — `compatibility.ts`: `COMPAT`,
   `PLUGIN_CAPABILITIES`, `parseSemver`/compare helpers (moved from
   `schema-extraction.ts`), `checkServerCompatibility()`, `CompatVerdict`.
   Unit tests for every verdict branch incl. "inventory still loading".
2. **Gate A** — status route returns `compat`; admin compute page renders the
   badge + message. (Status route change is additive; page change is UI-only.)
3. **Gate C** — per-server verdict cache in `client-cache.ts` with TTL +
   hard-fail on incompatible; new `ErrorCodes.INCOMPATIBLE_PLUGIN`; wrap SLVA
   parse + solve-output validation failures into it; solve route maps to a
   user-readable error. Tests: solve against a mocked server reporting an
   incompatible plugin fails _before_ the solve request; SLVA v(max+1) blob
   produces the mapped error, not a raw throw.
4. **Gate B** — `minPluginVersion`-vs-server check at upload; share helpers
   with the compat module.
5. **Wire-format codegen** — `wire-format.json` + TS/C# generation + bump
   guard; replace both hand constants; `pnpm generate` diff is the review
   surface.
6. **C# policy alignment** — tighten `ValidateCompatibility`; update
   `Selva.Tests`.

Changeset: minor for `@selvajs/compute` (new public API), patch/minor for
`@selvajs/server` + app; plugin change (5, 6) rides the next plugin release.

## Non-goals

- **No format negotiation / dual-format emit.** Pre-release, a hard early
  verdict with a good message is enough; negotiation (client advertises max
  SLVA version in the solve request) is a later, additive step if ever needed.
- **No new plugin-side endpoint.** `/plugins/gh/installed` already reports the
  plugin version; the baked schema already carries `pluginVersion` /
  `minPluginVersion` / `schemaVersion`. All required data flows exist.
- **No persisted verdicts in `IComputeServerStore`.** Compatibility is a live
  property; persisting it invites staleness.
- **No WebSocket (port 8765) handshake in this plan.** Local-mode plugin↔UI
  drift is a different failure surface (the UI ships _inside_ the `.gha`, so
  embedded-mode versions can't drift; only dev-server mode can). Worth a
  follow-up `version` field in `InitialData` someday; out of scope here.
