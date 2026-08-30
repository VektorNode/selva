# Extract the SLVA codec into `Plugin/Selva.Slva`

Status: implemented (2026-08-29) — all phases done except the
`SerializableMaterial` collapse, skipped per its own gate (see the note in the
renames section). The identity/key redesign remains open as the follow-up.
Scope: C# only. Wire format, fixtures, and the TS parser do not change.

## Goal

Move the SLVA/SLVM mesh codec out of `Selva.GH.Features.Display.Services` into its
own Rhino-free class library so that

1. the project boundary matches the format boundary the wire design already has
   (core container vs `EXTN "selva.gh"`),
2. an external consumer can write/read `.slvm` files with their own attributes
   without referencing Grasshopper, and
3. the upcoming stable-identity redesign has a clean home instead of landing in
   the same grab-bag namespace.

Non-goals: no wire-format change, no fixture regeneration. The proof of
success is that `SlvaFixtureContractTests` and `SlvmFixtureContractTests` stay
green **without** `UPDATE_*_FIXTURES=1`, and the frozen `slva/v3` fixtures
still decode. Behavior may shrink (dead paths deleted — see "Prune first") but
never change for what remains.

## Why this is cheap

The boundary already exists, just not as a project: `Selva.Tests.csproj` cannot
reference Selva.GH (Grasshopper kills the net8 test host), so it `<Compile Link>`s
the Rhino-free codec sources and papers over two small seams with
`RhinoStubs.cs`. That linked file set, proven to compile without RhinoCommon, is
the new project's file list. The extraction replaces the link hack with a real
`ProjectReference`.

## Prune first: the pipeline is carrying dead weight

Selva is pre-first-release — removals are free. Deleting these _before_ the
move means less to move and a pipeline with one path instead of three:

1. **`MeshBatchProcessor` + the OBSOLETE WebDisplay snapshots.** The live
   `GH_WebDisplay` no longer calls `MeshBatchProcessor`; its only callers are
   the four OBSOLETE WebDisplay snapshots (v0_2_0 … v0_14_0). With no installed
   users there are no saved definitions to upgrade — delete the snapshots,
   their upgraders, and `MeshBatchProcessor` with them. (v0_15_0 goes too
   unless a teammate has live files worth keeping.)
2. **DMF1 legacy container.** `SlvmFile.ReadLegacy` + `LegacyExtension` exist
   to read `.dmf` files nobody has. Delete, along with the DMF1 cases in
   `SlvmFileTests`. Writers already emit only SLVM v2.
   **Partially reverted:** `.dmf` files do exist after all, so the DMF1
   _reader_ is back in `SlvmFile` (read-only dispatch on the magic, plus its
   test). The writer-side traces stay deleted.
3. **`MeshBatchSerialization`.** Its single caller is
   `DisplayBatchTransformer`'s legacy re-encode path; if that path serves only
   pre-SLVM batches, both go. Verify the transformer's live use
   (`WebDisplayGoo` Transform/Morph) doesn't reach it first.
4. **Stale artifacts**: `ThreeMaterial`'s unused `using System.Reflection`, the
   stale `Logger` comment in `RhinoStubs.cs`, `SlvaTestDecoder.cs:9`'s stale
   "can't be linked here" claim.

Each deletion is its own commit, gated by the full test suite. If any of these
turns out to be load-bearing, drop that item, not the phase.

## What moves

New project `Plugin/Selva.Slva/`, single flat namespace `Selva.Slva`, folders
for orientation only:

| Folder       | Files (moved verbatim from `Selva.GH/Features/Display/Services/`)                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Geometry/`  | `BinaryGeometryWriter.cs`, `BinaryGeometryReader.cs`, `BlobCompressor.cs`                                                                                                  |
| `Container/` | `SlvmDocument.cs`, `SlvmFile.cs`                                                                                                                                           |
| `Model/`     | `DisplayBatch.cs` (incl. `MaterialGroup`, `MeshMetadata`, `SerializableMaterial`), `DisplayItem.cs` (incl. `DisplayPosition`), `ThreeMaterial.cs`, `ColorJsonConverter.cs` |
| `Pipeline/`  | `MeshBatchAssembler.cs`, `DisplayBatchCombiner.cs`, `MaterialCache.cs` (+ `MeshBatchSerialization.cs` only if it survives the prune)                                       |

Stays in Selva.GH (Rhino- or plugin-coupled): `MeshBatchProcessor`,
`GeoMeshProcessor`, `CurveTessellator`, `CurveFlatness`,
`DisplayBatchTransformer`, `WebDisplayPreview`, `TextureAssetStore` (static
state + `LocalWebServer` coupling).

`ThreeMaterial` moves even though GH components create it: it is pure
System.Drawing, it is the assembler's input type and `MaterialCache`'s key, and
its `[JsonProperty]`/`ColorJsonConverter` shape is a persisted contract
(`ThreeMaterialGoo` writes it into `.gh` archives as JSON — namespace moves are
invisible to that).

### The one real seam: `DisplayItem.Point(Point3d, …)`

The only Rhino type in real code across the moved set. Fix: the core factory
takes `DisplayPosition`; Selva.GH gets a one-line static helper
(`Features/Display/Services/RhinoDisplayItems.cs`) converting `Point3d` →
`DisplayPosition`. Update the ~4 call sites (`GH_WebDisplay`, OBSOLETE
WebDisplay v0_14/v0_15 — call-site edits in OBSOLETE files are safe; the frozen
contract there is params/GUIDs, not compilation details). `RhinoStubs.cs` then
keeps only what `CurveFlatness` needs (`Point3d`/`Vector3d` math).

## Project wiring

`Selva.Slva.csproj` — copy the `Selva.Schema` shape:

- `netstandard2.0` (codec is Rhino-free; consumed by net48/net7/net9).
- Central package management: bare `<PackageReference>`s for `Newtonsoft.Json`,
  `System.Drawing.Common` (already pinned 8.0.0), and `System.Buffers`
  (new `<PackageVersion>` in `Directory.Packages.props`; `BinaryGeometryWriter`
  uses `ArrayPool<byte>`).
- `Nullable` stays **off** for the move (the files predate it and
  `TreatWarningsAsErrors` is repo-wide); enable per-file later if wanted.
- `dotnet sln add` to `Selva.sln`.

**Release packaging: merge into `Selva.gha`, Schema-style — mandatory, not
optional.** `ColorJsonConverter` subclasses Newtonsoft's `JsonConverter` and is
used from Selva.GH (`ThreeMaterialGoo`), so the library's public API exchanges
Newtonsoft types with Selva.GH. If Selva.Slva shipped as a sibling DLL while
Newtonsoft gets internalized into Selva.gha, those calls bind across the
internalized-type boundary and break at runtime. Extend
`ILRepackMergeNewtonsoft` in `Selva.GH.csproj`: add `Selva.Slva.dll` to
`_RepackToStage`, `_RepackInputMerge`, and the trailing `<Delete>` (forgetting
the delete ships a stale sibling next to the merged copy — duplicate types).
Debug builds keep it as a sibling DLL, same as Schema. Yak staging copies whole
TFM output folders, so no build-script change; `Selva.PluginVerifier` force-JITs
the merged .gha on Windows and catches merge mistakes.

## Tests

New `Plugin/Selva.Slva.Tests/` (net8.0, xunit, plain `ProjectReference`,
`TreatWarningsAsErrors` stays on — no linked-source CS0436 here). Moves from
`Selva.Tests`: `BinaryGeometryWriterTests`, `BinaryGeometryReaderTests`,
`BinaryGeometryWriterBenchmarks`, `BlobCompressorTests`, `SlvmDocumentTests`,
`SlvmFileTests`, `MeshBatchAssemblerTests`, `DisplayBatchCombinerTests`,
`SlvaFixtureContractTests`, `SlvaFrozenFixtureTests`,
`SlvmFixtureContractTests`, `SlvaTestDecoder`.

- The repo-root walk (find `pnpm-workspace.yaml`, then
  `packages/schemas/fixtures/…`) is currently duplicated in two test files —
  consolidate into one `FixtureLocator` helper in the new project. Fixtures do
  not move: they are the cross-stack contract the TS tests read.
- `Selva.Tests` keeps the rest (schema, tombstone, `CurveFlatness` +
  `RhinoStubs`), drops the ~13 codec `<Compile Link>` entries, and takes a
  `ProjectReference` on Selva.Slva for any remaining linked file that touches
  codec types. Two stale comments to delete while there: the `Logger` stub
  claim in `RhinoStubs.cs` and `SlvaTestDecoder.cs:9`'s "can't be linked here".
- CI: `test.yml`'s dotnet job lists test csprojs explicitly — add
  `Plugin/Selva.Slva.Tests/Selva.Slva.Tests.csproj` or it silently never runs.

## Renames (separate commit, after the move compiles)

Wire magics and fixture bytes are frozen; class names are free (pre-release, no
consumers). Keep names wire-accurate:

- `BinaryGeometryWriter` → `SlvaWriter`, `BinaryGeometryReader` → `SlvaReader`
  (they read/write the `SLVA` blob; "binary geometry" says nothing).
- `BlobCompressor` → `SlvzCompressor` (it is the `SLVZ` wrapper).
- `SlvmDocument` / `SlvmFile` keep their names — `SLVM` is the container magic;
  the SLVA/SLVM distinction is real and documented.
- Model names (`DisplayBatch`, `MeshMetadata`, `DisplayItem`) stay; they are
  descriptive and renaming them churns every component.

Do the `git mv` in one commit and the renames in another so history follows.

Two structural simplifications belong in this pass, both fixture-gated
(bytes must not change):

- **Split `SlvmDocument.cs` (1,120 lines) along the format's own layers**:
  chunk stream I/O, the TABL columnar codec, and the `selva.gh` extension
  writer/reader each get a file — mirroring how the TS side is shaped
  (`binary/slvm.ts` vs `binary/geometry.ts`). One wire layer per file is most
  of what "easy to understand" means here.
- **Collapse `SerializableMaterial` into `ThreeMaterial`.** Two material types
  plus two-way converters exist only because Color needs a hex-string JSON
  form — which `ColorJsonConverter` already provides. One type with the
  converter, provided the MATL JSON and the `ThreeMaterialGoo` archive JSON
  stay byte-identical; if they can't, keep the pair and skip this item.
  **Skipped:** it can't stay byte-identical. `SerializableMaterial` preserves
  the color string verbatim through JSON round-trips; a `Color`-typed field
  re-emits through `ColorTranslator.ToHtml`, which maps named colors
  (`"#ff0000"` → `"Red"`) and so changes MATL bytes on rebuild paths — and the
  lenient bad-color fallback in `ToThreeMaterial` would be lost.

## Reuse API (what the external consumer gets)

Mostly already there; the format was designed for it. Two small additions:

1. **Per-mesh custom attributes need no work.** `MeshMetadata.Metadata`
   (`Dictionary<string, string>`) already flows into TABL sparse attr columns
   (`gh:branch`, `ifc:guid`, …). Document the namespacing convention
   (`myapp:key`) in the new README.
2. **Generalize EXTN.** `SlvmDocument.Write` currently builds only the
   `selva.gh` extension. Add pass-through: writer accepts extra named EXTN
   payloads, reader surfaces unknown EXTN chunks instead of skipping them.
   `selva.gh` becomes the first client of that API instead of a special case.
   (Behavior-identical for Selva's own output.)
3. **Give `CreateBatch` a per-mesh input type.** Nine parallel lists
   (`vertexArrays`, `faceArrays`, `names`, `materials`, `metadataList`,
   `layers`, `uvArrays`, `colorArrays`, …) plus five length-check throws is a
   hostile shape for an external caller. One
   `SlvaMeshInput { Vertices, Faces, Name, Layer, Material, Attrs, Uvs, Colors }`
   and a single `IReadOnlyList<SlvaMeshInput>` makes misalignment
   unrepresentable and deletes the validation block. Internal callers are few
   (`GH_WebDisplay`, combiner, tests). Output bytes unchanged — fixture-gated.

Consumption mode for the external project: project reference or git subtree —
no NuGet publishing yet. The committed fixtures double as his conformance
suite: if his writer changes shared code, `SlvaFixtureContractTests` reddens.

Plus `Selva.Slva/README.md`: what the library is, the three wire layers
(SLVA blob / SLVZ / SLVM container), core-vs-`selva.gh` layering, how to write
a batch from raw arrays (`MeshBatchAssembler.CreateBatch` → `SlvmDocument.Write`),
extension points, and the fixture-contract rule ("change writer and TS reader
together and bump the version").

## Phases

Each phase ends with: `cd Plugin && dotnet build && dotnet test` (both new and
old test projects), `dotnet build --configuration Release` for the merge path,
and `pnpm test` in `packages/visualization` for the TS fixture side. Fixture
contract tests must pass **without** regeneration at every step.

0. **Prune.** Dead-path deletions above, one commit each.
1. **Create + move.** New csproj, sln entry, `Directory.Packages.props` entry,
   `git mv` the 12 files, namespace swap, `DisplayItem` seam fix + GH helper,
   `using Selva.Slva;` across Selva.GH consumers, extend the ILRepack target,
   Selva.Tests: drop codec links, add ProjectReference.
2. **Test split.** Create `Selva.Slva.Tests`, move the 12 test files +
   `FixtureLocator` consolidation, update `test.yml`.
3. **Renames + internal simplification + docs.** `SlvaWriter`/`SlvaReader`/
   `SlvzCompressor`; the `SlvmDocument` split and material-type collapse; update
   pointers in `docs/contributing/slva-format.md` (it names
   `BinaryGeometryWriter.cs`/`SlvmDocument.cs` as the normative specs),
   `packages/schemas/README.md`, `STRUCTURE.md` (new project section),
   CLAUDE.md architecture note; write `Selva.Slva/README.md`.
4. **EXTN pass-through** (can wait until the external consumer actually needs
   it). Writer/reader extension API as above.

## Risks

- **ILRepack**: the delete-after-merge and the "public API exchanges Newtonsoft
  types" rule are the two ways to ship a broken Release .gha; both are caught
  by `scripts/build-production.js`'s warning grep + PluginVerifier, but only on
  Windows. macOS builds net7.0 only — full Release verification happens in the
  release workflow.
- **Selva.Tests leftover links**: any remaining linked Selva.GH file that references a
  moved type now resolves via the ProjectReference — watch for CS0436-style
  double-definition if a codec file is accidentally left linked.
- **OBSOLETE components**: compile-level edits only (using directives, the
  Point3d helper). Param lists and GUIDs untouched.

## Known wart, deliberately deferred: the batch id has three names

One concept, three spellings: the C# property is `BatchId`, its JSON name is
`sourceComponentId` (guarded by "backward compatibility" comments protecting
published releases and old `.gh` files — but Selva is pre-first-release, so
they protect nothing), and the TS side documents it as the "identity
namespace" while `readSelvaExtension` accepts both key spellings. **Decision:
every object names its identity `id` in its own scope** — `DisplayBatch.Id`
(wire: `id` on the batch JSON), the per-mesh `id` attr, `DisplayItem.Id`. The
composite reference is batch id + mesh id; qualified names like `batchId`
appear only in prose, never as field names. Do **not** fix this during the
extraction (it crosses the C#/TS wire and belongs with the identity work); the
key redesign retires the other spellings, the dual-key acceptance, and the
stale backward-compat comments.

## Follow-up (separate plan): identity as a core format concept

The stable-identity redesign, with one decision already made: **a stable
per-mesh id is a core concept of the format, not a Selva convention.** Any
consumer wants to reference "the same mesh" across iterations of a model —
that need is not Grasshopper-specific, so the format owns the slot and the
writer owns the value:

- **Core**: a reserved per-mesh attr key `id`, carried by the existing TABL
  sparse-attr columns — zero new wire machinery, no version bump, foreign
  readers that ignore it lose nothing. Semantics documented in the core
  README: opaque string, stable across iterations of the same logical object,
  unique within the batch; batch id + mesh id is the full reference. How it is
  minted is the writer's business.
- **The batch id moves from `EXTN "selva.gh"` into the core container.** If
  the reference scheme is core, a foreign reader is entitled to the namespace
  half of it too. Optional small chunk (skipped by older readers, so
  version-safe); when absent, the consumer supplies the namespace — which is
  already the behavior (the envelope re-stamps reloaded `.slvm` parts per
  placement). The `selva.gh` EXTN then carries only genuinely Grasshopper
  things (the curve NURBS JSON).
- **Selva as one writer**: mint the id C#-side at assembly time from what is
  actually stable (component id + branch path + index-within-branch, name
  override when the user assigned one). The TS scene layer then keys hidden
  state/selection on a field read — replacing the four-tier guessing in
  `packages/visualization/src/scene/identity.ts` — and stores hidden state per
  source mesh rather than per merged object, so re-merging under a different
  material/layer grouping cannot lose it.
- Same pass retires the `batchId` triple-naming (see above).

This extraction plan deliberately lands first so that work has a clean home.
