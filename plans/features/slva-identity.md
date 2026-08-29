# One id per object: the SLVA identity redesign

Status: planned. Follow-up to [slva-extraction.md](./slva-extraction.md); supersedes its
follow-up sketch with the results of a full consumer census (C# + TS, 2026-08-29).

## The verdict from the census

Identity is the most over-built part of the pipeline. **One requirement** — "the thing I
hid must still be hidden after a re-solve" — is currently served by **seven mechanisms**:

1. The batch id under five spellings: `BatchId` (C#), `sourceComponentId` (envelope JSON),
   `batchId` + legacy `sourceComponentId` alias (EXTN), `identityNamespace` (TS option),
   `ws:${ordinal}` (plugin-ui synthesis) — plus an "envelope wins over embedded" precedence
   rule.
2. Mesh identity _derived_ as batch id + `originalIndex` (position in the input).
3. Item identity _minted_ as `"{batchId}:{ordinal}"` — a different scheme than meshes.
4. Merged-mesh identity as the sorted set of member indices.
5. A TABL permutation column (`originalIndex`) with an omission heuristic, plus
   `ParseItemOrdinal` string-parsing ids back into integers on write.
6. Restamp machinery that rewrites the EXTN chunk _and_ does string surgery on item id
   prefixes (`GH_DisplayFromFile.RestampSourceComponentId`).
7. A four-tier fallback ladder in `scene/identity.ts` reconstructing all of the above.

The census also surfaced **three real defects** the derivation causes:

- **Branch collision (bug, today):** all branches of one Display component share one batch
  id, but mesh `originalIndex` restarts per branch — two branches produce identical keys
  `{id}:0..n`, so hiding a mesh in branch A hides its twin in branch B. Items don't collide
  only because _their_ ordinal counter happens to be global — the two counters were never
  reconciled (`GH_WebDisplay.cs:350` global vs `MeshBatchAssembler` per-branch).
- **Index shift:** insert one mesh early in the tree and every later mesh's identity moves —
  hidden state lands on the wrong object.
- **Merge fragility:** any change to material/layer grouping changes the member set, so a
  merged mesh's hidden state silently evaporates.

And two confirmed non-facts that make deletion safe: **nothing** uses `originalIndex` for
anything but identity (all slicing is `vertexStart/vertexCount`; the one sort use is a
local tie-break), and **nothing** on the TS side needs the envelope batch-id copy once the
container itself is restamped per placement (both envelope overrides exist only to patch
around the embedded id not being restamped).

## Target: identity is one stored string

- **Per-object `id`** — opaque string, minted by the writer, stored in the TABL sparse-attr
  column under the reserved key `id`, for meshes, curves, and points alike. Readers never
  parse it. Semantics (core README): stable across iterations of the same logical object,
  globally unique because the mint bakes the producer in (below).
- **There is no batch id.** `DisplayBatch` loses the field entirely; the `selva.gh` EXTN
  carries only the curve NURBS JSON, so a mesh-only batch has no extension chunk at all,
  and all restamp machinery disappears — there is nothing left to restamp.
- **Viewer key** = the object id, read off userData. The parser stamps
  `userData.trackingKey` (NOT `userData.id`, which is already the viewer-aid tag namespace:
  `'grid'`, `'measure'`, …); `getTrackingKey` becomes a field read.

### Minting policy (Selva's, not the format's)

`GH_WebDisplay` mints in one pass over the input tree, same scheme for meshes and items,
**fully qualified**: `"{componentGuid}/{branchPath}/{indexInBranch}"` (e.g.
`"e4111712-…/{0;1}/3"`), counting invalid slots so a failed mesh doesn't shift its
neighbors. The id is permanent provenance — it says exactly which component, branch, and
slot produced the object, and it is globally unique by construction. That is what lets the
combiner **pass ids through untouched** (no re-minting, no provenance attrs — the id is
the provenance) while combined batches from many components stay collision-free. The
repeated GUID prefix costs nothing on the wire: the TABL is deflated and shared prefixes
compress away. The branch path is already in scope at both build sites
(`BranchResult.Path`). How another writer mints is its own business — the format treats
ids as opaque.

The object id is **permanent truth, never rewritten by anything**. Two accepted
consequences of having no placement namespace:

- Hidden state now _survives_ routing through Combine — keys never change downstream.
  (Today it doesn't; this is an improvement.)
- Two loader components opening the _same_ `.slvm` file share keys: hiding an object in
  one placement hides it in the other. Accepted; if it ever matters, the escape hatch is
  an optional id-prefix input on Display From File — a component feature, not a format
  change.

### Merged meshes: hidden state per member

`finalizeMergedMesh` (one shared function, sync + worker paths) keeps each member's
`{id, name, layer, metadata}` on `userData.members` (replacing the write-only `mergedFrom`).
Hiding a merged mesh adds every member key to the hidden set; after a solve an object is
hidden when all its member keys are hidden. Regrouping can then never lose state — the
merge key stops needing to be stable at all. (The plugin-ui WS path doesn't merge, so this
only affects the cloud path.)

### Fallback for foreign files

Objects with no `id` attr fall back to `name + layer`, then uuid — two tiers instead of
four. This keeps hidden-state persistence for foreign SLVM writers (the EXTN pass-through
consumers) that set names but no ids; the Selva.Slva README tells them to write `id` attrs
for first-class behavior.

## What gets deleted

C# (per census):

- `MeshMetadata.OriginalIndex`, the TABL permutation column + its omission heuristic
  (`SlvmTable.cs:98,157-164,217-238`), `ParseItemOrdinal` (`SlvmTable.cs:361`).
- Item-id re-minting in `SlvmDocument.BuildItems` (`:348,367`) — the id is read from the
  attr column like everything else (split out of `Metadata` the way `style:*` already is;
  `MeshMetadata` gains an `Id` the same way).
- `DisplayBatch.BatchId` itself, with everything downstream of it: the
  `[JsonProperty("sourceComponentId")]` wire field, the whole `SelvaExtension` batch-id
  payload (incl. the legacy alias — the EXTN keeps only `curves`), `SlvmDocument.Restamp`,
  the `batchId` parameter of `StripItems`, `GH_DisplayFromFile`'s entire restamp feature
  (`RestampSourceComponentId`, `:91-116`, and its component option),
  `DisplayBatchCombiner.RestampItemIds` (`:271`), and `GH_CombineDisplay`'s per-branch id
  minting (`{InstanceGuid}-{path}`, `:86-92`).
- Legacy read paths beyond DMF1: the pre-v2 embedded-JSON metadata decode in
  `SlvaReader` (`:51`) goes if the DMF1 path doesn't need it (the DMF1 sidecar carries the
  batch JSON itself; verify, then delete). **The one legacy thing kept is `SlvmFile`'s
  DMF1 read dispatch** — read-only, no auto-upgrade of old files.
- Combiner provenance attrs (`gh:component` + `gh:originalIndex`, `WithProvenance`, the
  `nextIndexBySource` counters) go entirely: ids pass through the combiner verbatim and
  carry their own provenance.

TS (per census):

- `identity.ts` tiers 2–3 (`mergedIndices`, `sourceComponentId+originalIndex`) and all
  stamping of `userData.sourceComponentId` / `userData.originalIndex` /
  `userData.mergedIndices` (`merge.ts:128,132,213`, `batch-parser.ts:274,285-289,431`).
- The entire `fallback.sourceComponentId` / `identityNamespace` channel
  (`batch-parser.ts:100-104,121-125,145,183-188,211,345`, `types.ts:82-89`) and the
  `ws:${ordinal}` synthesis (`websocket-solve-driver.ts:132-141`).
- The envelope `DisplayBatch.sourceComponentId` field (`types.ts:61-65`).
- `MeshMetadata.originalIndex` + the TABL permutation decode (`slvm.ts:230-236,273`).
- The `originalIndex`/`sourceComponentId` exclusion entries in `Viewer.svelte:325-326` /
  `MeshMetadataDialog.svelte:16` (replaced by excluding `id`).

## Wire consequences

Deleting the TABL column shifts the columns after it → **SLVM version 2 → 3**, both sides
in one change (`SlvmDocument`/`SlvmTable` ↔ `binary/slvm.ts`), per the format doc's rule.
Pre-release, readers accept only v3; the `slvm2/` fixtures are regenerated
(`UPDATE_SLVM_FIXTURES=1`) into `slvm3/`. The frozen `slva/v3/` geometry fixtures are
untouched — the geometry blob layer doesn't change at all. DMF1 legacy reads keep working;
their embedded `originalIndex` JSON field is silently dropped, which is fine because those
identities were index-derived anyway.

## Order of work

1. **C# minting + wire** — mint ids in `GH_WebDisplay`, add the `Id` fields and the
   reserved-attr handling, bump SLVM to v3, delete the permutation column, `BatchId`, and
   all derivation/restamp machinery, regenerate slvm fixtures.
2. **TS reading** — decode the id attr, stamp `userData.trackingKey` and
   `userData.members`, collapse `identity.ts`, delete the fallback channel and envelope
   field.
3. **Viewer semantics** — per-member hidden logic in `visibility.ts` (`setVisible`/
   `applyTo`/layer tri-state over member keys).
4. **Cleanup** — update `slva-format.md`, the Selva.Slva README (id semantics for foreign
   writers), and the metadata-dialog exclusion lists.

Each step gates on: both C# test projects, the TS suites, and the frozen `slva/v3`
fixtures still decoding.
