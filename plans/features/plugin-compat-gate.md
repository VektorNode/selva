# Plugin ↔ app compatibility gate — plan

> **Status: PLANNING (revised 2026-08-04).** Design only — no implementation yet.
>
> Problem: when a definition, the Selva plugin on a Rhino.Compute server, and the
> `@selvajs/*` packages in the deployed app drift apart, the mismatch is
> discovered **mid-solve** — or, worse, never. Some drift throws (SLVA version);
> most degrades **silently**, dropping geometry with at most a `console.warn` in
> one user's browser while the solve reports success.
>
> This plan adds a declared compatibility contract, enforces it at three points,
> and — new in this revision — makes the drift **attributable**, so an operator
> can answer "which definitions are affected?" before deprecating anything.

---

## What changed in this revision (2026-08-04)

The 2026-07-22 draft framed compatibility as a **server-vs-app** property: which
plugin does this compute box run. Re-verification against the code found that
framing incomplete in ways that invalidate parts of the plan.

**1. The drift unit is the `.gh` file, not the server.** `OBSOLETE_*` components
are not upgrade stubs — they are frozen, fully functional solvers
(`OBSOLETE_WebDisplay_UntilV0_15_0.cs` carries its own `SolveResult_V0_15_0`,
branch batching and encode path). Five WebDisplay generations ship in the
`.gha`. An `IGH_UpgradeObject` fires only when a human opens the definition on a
canvas and re-saves; on a headless compute box the stored bytes instantiate the
**old** component and it solves happily forever. Every gate below reports
"compatible" in that case — new plugin, current schema, SLVA v3 — while the old
component emits an older payload shape.

**2. `minPluginVersion` is never written in production.** Verified: the only
assignments in `Plugin/` are in `Selva.Tests`
(`SchemaMigratorTests.cs:170`, `SchemaValidatorTests.cs:385`).
`BridgeOrchestrator.cs:288` sets `PluginVersion` and nothing sets
`MinPluginVersion`. **Gate B as drafted is therefore a no-op** — its `if (set)`
condition is never true. The C#-side gate at `SchemaMigrator.cs:350-368` is live
code that can never fire for the same reason.

**3. `ValidateCompatibility` is dead code.** Zero production callers
(`SchemaMigrator.cs:491` is the definition; the only other hit is a comment at
`:49`). Work item 6 as drafted changes code nothing reaches.

**4. Silent degradation is the dominant failure mode, not loud failure.** The
draft's "Where a mismatch surfaces today" listed only throwing paths. There are
three non-throwing channels, and they carry the deprecation risk.

**5. The schema axis largely self-heals** — the stored schema is a disposable
cache re-derived from the live plugin on render
(`load-for-render.ts:179-185`), so a plugin upgrade lazily refreshes it. Schema
drift is the axis least in need of new gating.

Line references in the original draft had also drifted; corrected throughout.

---

## Current state (verified 2026-08-04)

Four versioning axes exist; none are tied together before a solve.

| Axis                                                 | Source of truth                                                                                     | Consumers / gates today                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI schema format** (`schemaVersion`, `2.12.0`)     | `packages/schemas/ui-schema.json` default                                                           | C#: `SchemaMigrator` migrates older (11 steps, 1.0.0 → 2.12.0). `ValidateCompatibility` (`SchemaMigrator.cs:491-529`) rejects newer **major** only — **and has zero production callers**. TS: `assertSupportedSchemaVersion` rejects **any newer** semver (`packages/server/src/definitions/schema-extraction.ts:37-56`). |
| **Plugin version** (assembly version, e.g. `0.15.4`) | `Plugin` assembly                                                                                   | `pluginVersion` stamped into the schema (`BridgeOrchestrator.cs:288`) but **never read on the TS side**. `minPluginVersion` **never assigned in production**; its C# gate (`SchemaMigrator.cs:350-368`) is unreachable. Not in any WS or compute envelope.                                                                |
| **SLVA binary mesh format** (v3, min supported v1)   | duplicated by hand: C# `BinaryGeometryWriter.cs:73` (`Version = 3`) and TS `binary/header.ts:18,24` | TS parser throws `VisualizationError` on out-of-range version (`binary-parser.ts:179-185`) — and kills the **whole response**. C# reader **discards the version entirely** (`BinaryGeometryReader.cs:56`). No guard keeps the constants in sync; no negotiation.                                                          |
| **Compute server / installed plugin inventory**      | Rhino.Compute `/version`, `/plugins/gh/installed`                                                   | Queried by `ComputeServerStats.getVersion()` / `getInstalledPlugins()` (`packages/compute/src/core/server/compute-server-stats.ts:184-262`); surfaced **display-only** in `packages/selva/src/routes/api/admin/compute/status/+server.ts`. The solve path never looks at it.                                              |

Already solved (don't re-plan): the `schemaVersion` constant is **not**
triplicated — `generate-csharp.js:778-806` regenerates
`Plugin/Selva.Schema/Constants/SchemaVersion.cs` from the JSON default, and both
codegen scripts hard-fail if schema definitions change without a version bump
(`checkSchemaVersionBumped`). JSON ↔ TS ↔ C# schema version cannot silently
drift. The **SLVA version pair has no such guard** — that's a real gap.

### Where a mismatch surfaces today

Ordered by how hard it is to notice — the quiet ones are the dangerous ones.

| #   | Channel                  | Old → New        | New → Old                  | Signal                     |
| --- | ------------------------ | ---------------- | -------------------------- | -------------------------- |
| 1   | SLVA **flag bits**       | fine             | attribute silently dropped | **none at all**            |
| 2   | JSON **display items**   | item dropped     | unknown `kind` dropped     | one `console.warn`         |
| 3   | Curve `json` vs `points` | curve dropped    | n/a                        | one `console.warn`         |
| 4   | SLVA **version number**  | fine (by design) | whole response dies        | fatal `VisualizationError` |
| 5   | Schema format            | migrated (C#)    | rejected at upload         | good error message         |

**(1) is the sharpest gap.** Trailing chunks are gated per flag bit and the
parser then simply returns (`binary-parser.ts:301,308,313`). An unrecognized bit
5+ set by a newer plugin is never examined — no warn, no throw — and its bytes
are left unread at the tail. Geometry renders, missing an attribute, with zero
diagnostic. The writer's own comment (`BinaryGeometryWriter.cs:320-322`) calls
this "degrade gracefully", which is correct for _old reader / new optional
data_ and silent data loss for everything else. There is **no middle ground**:
bumping `Version` to signal the change converts silent-partial loss into
fatal-total failure (#4).

**(2) and (3)** are warn-and-skip: `display-items-parser.ts:45-51` for unknown
kinds, `items/curves.ts:75-88` for a curve with neither `points` nor a rhino3dm
instance. Absence is indistinguishable from "this definition legitimately has no
curves."

**A live example, today, in the working tree.** The uncommitted display-pipeline
change adds backend tessellation (`points`) and marks the 7-arg
`DisplayItem.Curve(json, …)` overload `[Obsolete]`. Both OBSOLETE WebDisplay
components still call exactly that overload
(`OBSOLETE_WebDisplay_UntilV0_14_0.cs:534`,
`OBSOLETE_WebDisplay_UntilV0_15_0.cs:642`) and emit `json` with **no `points`**.
Only one call site in the monorepo passes a rhino3dm loader
(`packages/selva/src/routes/library/[guid]/+page.svelte:43`); the plugin-ui
WebSocket path passes none
(`websocket-solve-driver.ts:158`). Net effect for a definition using an old
Display component: **curves silently vanish, solve reports success.**

### C# and TS disagree about the same bytes

```
BinaryGeometryReader.cs:56   br.ReadUInt32(); // version — layout is forward-compatible
binary-parser.ts:179         if (version < MIN || version > MAX) throw
```

C# discards the version; TS hard-rejects anything above 3. Since the C# reader
handles `.gh`/DMF round-trips, a definition can persist a blob Rhino reads fine
and the browser refuses. `wire-format.json` codegen (§4) unifies the _constants_
but **not** this — the two readers implement different _policies_.

### An operator cannot currently answer "who is affected?"

This is the finding that gates deprecation, and it is worse than "no telemetry":

- `pluginVersion` **is** in the stored schema blob — and nothing in TS reads it.
- `solve_metrics` records no plugin version, no schema version, no
  compute-server id (`packages/platform/src/metrics/interface.ts:39-71`), and
  has **no read policy** for authenticated users
  (`20260615120000_selva_solve_metrics.sql:53-56`). No query path exists even if
  the column did.
- The one queryable artifact is a Supabase **generated column**
  (`schema_version`, `20260711120000_…sql:13-15`), documented as never read by
  the app — and it does **not exist on the local provider**, which records no
  solve metrics at all (`LocalDataProvider.ts:98`).
- No admin page lists definitions with their versions; the version-list endpoint
  explicitly strips the schema (`platform/src/definitions/interface.ts:58-62`).

So: **zero visibility on local deployments; one raw SQL query on Supabase** that
reveals the schema format and says nothing about the Display component
generation — the axis that actually governs the code we want to delete.

---

## Design

### Unified policy (decide once, apply everywhere)

**A consumer rejects anything newer than itself; producers always emit their
current version; older input is migrated (C#) or accepted (TS).**

Concretely:

- TS keeps its existing strict rule (any newer `schemaVersion` → reject) — the
  renderer cannot know constructs it wasn't built with.
- SLVA: parser keeps `[MIN_SUPPORTED_VERSION .. BINARY_MESH_VERSION]`; a writer
  above the parser's max is _incompatible_, full stop (no dual-format emit —
  see non-goals).
- **New: silent degradation is not an acceptable outcome.** Any path that drops
  renderable content must produce a counted, structured signal (§6), not a
  console warning.

### 1. Compatibility contract (`@selvajs/compute`)

New module `packages/compute/src/core/server/compatibility.ts` exporting a
single declared contract plus a version→capability table:

```ts
export const COMPAT = {
	/** Schema format this app renders (from @selvajs/schemas). */
	schemaVersion: UI_SCHEMA_VERSION,
	/** SLVA range this app parses (re-exported from binary/header). */
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

The table turns "plugin 0.16.0 installed" into "that plugin emits SLVA v4, this
app parses ≤ v3" **before** any solve. Unknown-but-newer plugin versions (no
matching row) degrade to a _warning_ verdict, not a hard block — the table can
lag a release without bricking solves.

> **Caveat (new).** This table is hand-maintained and must be updated on every
> wire-format release. A lagging table silently downgrades real incompatibilities
> to warnings — the same failure class this plan exists to remove. It is the
> weakest link here; §4's codegen is the mechanically reliable half and should
> land first.

No new semver dependency: reuse/extend the tiny `parseSemver` from
`schema-extraction.ts:25-28` (move it into the compat module and re-export).

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

**Scope limit — state plainly.** This verdict describes the _server_. It cannot
detect a definition solving through an OBSOLETE component, which is the failure
mode §5–§6 address. Do not let a green verdict here be read as "this definition
is fine."

### 3. Three enforcement points

**Gate A — admin status (earliest, cheapest).**
`packages/selva/src/routes/api/admin/compute/status/+server.ts` calls
`checkServerCompatibility` (it already has the `stats` instance and the plugin
map — pass the map in to avoid a second fetch) and adds `compat: CompatVerdict`
to its JSON. The admin compute page renders it: red badge + verdict message for
incompatible, amber for `unknown`, instead of an unconditional green "online".
No persistence in `IComputeServerStore` — the verdict is a live property of the
server, recomputed per probe.

**Gate B — definition upload/extraction. ⚠ BLOCKED.**
The drafted check ("if `schema.minPluginVersion` is set…") can never fire:
`MinPluginVersion` is never assigned in production code. Two prerequisites
before this gate does anything:

- **B0 (plugin):** stamp `MinPluginVersion` in `BridgeOrchestrator` alongside
  `PluginVersion`, with a defined policy for what value a component set declares.
  Rides a plugin release.
- **B1 (app):** only then does the upload-time check have an input. Behaviour as
  drafted — reject when the serving server's Selva version is older than the
  schema requires, catching multi-server configs where _other_ servers lag.

Still worth doing now regardless: move `parseSemver` + the compare helper into
the compat module so B and any C#-mirroring rule share one implementation.

**Gate C — solve path (backstop + cached pre-check).**

- _Cached pre-check:_ where the compute client is constructed per server
  (`packages/solve/src/server/client-cache.ts`), run
  `checkServerCompatibility` once per server per TTL (~5 min, in-memory beside
  the client cache). Hard-fail fast on `plugin-missing` / `plugin-too-old` /
  `plugin-too-new`; log-and-continue on `unknown`.
- _Error mapping:_ wrap the SLVA parse site so `Unsupported SLVA version N`
  surfaces as a typed `RhinoComputeError` with
  `ErrorCodes.INCOMPATIBLE_PLUGIN` (new code) and a message naming both
  versions and the fix ("compute server runs Selva plugin X emitting mesh format
  N; this app supports ≤ M — update @selvajs packages or install plugin ≤ Y").
  The solve route maps it to a 4xx/5xx the UI can show verbatim.

> Note: the draft said "and the schema-Zod failures on solve output". There is
> **no Zod in `packages/visualization/src`** — the display envelope is untyped
> and trusted (`response-envelope.ts` is interfaces only). Error mapping applies
> to the SLVA throw and the hand-rolled `validateGroupMetadata` throws
> (`batch/metadata.ts:18-72`), not to Zod.

### 4. Close the SLVA duplication gap

The two hand-maintained constants (`BinaryGeometryWriter.Version` and
`BINARY_MESH_VERSION`) get a single source: add a `wire-format.json` to
`packages/schemas` (`{ "slva": { "version": 3, "minSupported": 1 } }`) and have
both codegen scripts emit the constants (TS const + a small generated C#
`WireFormat` class), same pattern as `SchemaVersion.cs`. The existing bump-guard
machinery extends to it.

**Also reconcile the reader policies** (see "C# and TS disagree" above).
Unifying the constant does not unify the behaviour: decide whether the C# reader
should validate the version like TS does, or whether TS should tolerate unknown
_newer_ versions whose flag bits it understands. Pick one and encode it in both
readers; today the same blob is valid in Rhino and fatal in the browser.

### 5. Payload provenance — make drift attributable **(new)**

Nothing in the display payload identifies its producer. Verified absent from
`DisplayBatch` (TS `webdisplay/types.ts:58-68`, C# `DisplayBatch.cs:13-45`),
`BinaryMeshMetadata` (`binary/header.ts:74-78`), `DisplayComputeResponse`
(`response-envelope.ts:8-22`) and C# `DisplayItem.cs:21-91`. The SLVA header's
uint32 identifies the geometry **encoder**, not the plugin or the component.

- **5a — stamp the envelope.** Add a producer identity to the display batch
  envelope: emitting plugin version plus the **component generation** that
  produced it (an OBSOLETE component must report its own frozen identity, not
  the host plugin's version — that distinction is the entire point).
- **5b — persist per definition version.** Promote producer identity to a real
  column on **both** providers, not a Supabase-only generated column, so the
  local provider is not blind. Refresh on solve.
- **5c — expose it.** An admin view answering _"which definitions still solve
  through an OBSOLETE Display component, and when were they last solved?"_

This is the precondition for deprecation, not a nice-to-have: **you cannot
retire the legacy path until you can count who is on it.**

### 6. Make degradation countable **(new)**

Every silent-skip site becomes a structured, aggregated outcome on the solve
result rather than a `console.warn`:

- unknown display-item `kind` (`display-items-parser.ts:49`)
- curve with neither `points` nor rhino3dm (`items/curves.ts:79-83`)
- batch with missing `compressedData` (`batch-parser.ts:87-91`, currently
  returns `[]` with **no log at all**)
- batch whose material groups are absent both places (`batch-parser.ts:201-207`
  → zero meshes, no diagnostic)
- **unknown SLVA flag bits** — requires a "known flags" mask so bits outside it
  are detectable at all

Then add a **capability floor**: let the writer declare which flag bits are
_required_ vs _optional_, so an old reader can distinguish "I skipped something
decorative" from "I skipped something structural". That is the missing middle
ground between silent-partial (#1) and fatal-total (#4).

### 7. C# `ValidateCompatibility` — dead code

Tightening it from "newer major" to "any newer `schemaVersion`" was drafted as
work item 6. It has **zero production callers**, so the change is inert. Either
wire it into a real path or delete it; do not book it as closing a gap. Low
priority either way.

---

## Work items

Reordered by "what actually reduces risk". 1–3 are the deprecation
prerequisites; 4–6 are the original server-gate plan; 7–8 are cleanup.

1. **Payload provenance (§5)** — envelope stamp + per-version persistence on
   both providers + admin view. **Blocks any deprecation of the legacy display
   path.** Plugin change rides the next release.
2. **Countable degradation (§6)** — structured skip counts on the solve result;
   known-flag mask so unknown SLVA bits are detectable; capability floor.
3. **Wire-format codegen (§4)** — `wire-format.json` + TS/C# generation + bump
   guard; replace both hand constants; **plus** reconcile the C#/TS reader
   version policies. `pnpm generate` diff is the review surface.
4. **Compat module in `@selvajs/compute` (§1, §2)** — `COMPAT`,
   `PLUGIN_CAPABILITIES`, `parseSemver`/compare helpers (moved from
   `schema-extraction.ts`), `checkServerCompatibility()`, `CompatVerdict`.
   Unit tests for every verdict branch incl. "inventory still loading".
5. **Gate A** — status route returns `compat`; admin compute page renders the
   badge + message. (Status route change is additive; page change is UI-only.)
6. **Gate C** — per-server verdict cache in `client-cache.ts` with TTL +
   hard-fail on incompatible; new `ErrorCodes.INCOMPATIBLE_PLUGIN`; wrap SLVA
   parse + `validateGroupMetadata` failures into it; solve route maps to a
   user-readable error. Tests: solve against a mocked server reporting an
   incompatible plugin fails _before_ the solve request; SLVA v(max+1) blob
   produces the mapped error, not a raw throw.
7. **Gate B (§3)** — **blocked on B0**: plugin must stamp `MinPluginVersion`
   first. Then the upload-time check.
8. **C# `ValidateCompatibility` (§7)** — wire it up or delete it. Not a gap
   closure either way.

Changeset: minor for `@selvajs/compute` (new public API), minor for
`@selvajs/visualization` (envelope + solve-result shape), patch/minor for
`@selvajs/server` + app; plugin changes (1, 2, 3, 7) ride plugin releases.

## Non-goals

- **No format negotiation / dual-format emit.** Pre-release, a hard early
  verdict with a good message is enough; negotiation (client advertises max
  SLVA version in the solve request) is a later, additive step if ever needed.
- **No new plugin-side endpoint.** `/plugins/gh/installed` already reports the
  plugin version. (Note: the original draft also claimed "the baked schema
  already carries `minPluginVersion`" — it does not; see §3 Gate B.)
- **No persisted verdicts in `IComputeServerStore`.** Server compatibility is a
  live property; persisting it invites staleness. This does **not** apply to
  §5b payload provenance, which is a property of the stored definition version
  and must be persisted.
- **No automatic migration of definitions solving through OBSOLETE components.**
  Making them _visible_ (§5) is in scope; rewriting user files is not.
- **No WebSocket (port 8765) handshake in this plan.** Local-mode plugin↔UI
  drift is a different failure surface (the UI ships _inside_ the `.gha`, so
  embedded-mode versions can't drift; only dev-server mode can). Worth a
  follow-up `version` field in `InitialData` someday; out of scope here.
