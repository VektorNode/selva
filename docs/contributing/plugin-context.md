# Grasshopper plugin context

How the Grasshopper plugin's pieces actually fit together — the wiring rules and identity
invariants that decide whether a definition works.

How to author a definition — what each component is, where it sits on the ribbon, how to wire one
up — is covered by video rather than prose. This file is the layer underneath: the rules a tool or
a person editing a `.ghx` by hand has to honour, and the traps that fail silently.

**Everything here fails silently.** No exception, no red component, no validation error. The
symptom is a blank UI, a stale value, or an output that never appears.

## The four identity rules

### 1. The schema needs its own ContextBake, nicknamed `Schema`

The UI Bridge finds its schema bake by walking its own `Schema` output's recipients and requiring
**`bake.Params.Input[0].NickName == "Schema"`**, ordinal and case-sensitive
([BridgeOrchestrator.cs:433-462](../../Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs#L433-L462)).
Miss it and the plugin refuses to serve the UI at all:

> UIBridge Schema output is not connected to a Context Bake component with param name "Schema".
> Wire it up in Grasshopper first.

Schema saves are rejected on the same check. The stock Hops bake ships as `Content`/`Content`; the
`Schema` nickname is written **only** by the auto-scaffold path
([GH_UIBuilderComponent.cs:624](../../Plugin/Selva.GH/Features/UIBuilder/Components/GH_UIBuilderComponent.cs#L624)),
so a hand-placed bake keeps `Content` and does not qualify.

**Value goos must not share that bake.** The schema read takes the `Schema`-nicknamed input's
`AllData(true).FirstOrDefault()` and tests `data is UISchemaGoo` — first goo wins, no search
([BridgeOrchestrator.cs:463-474](../../Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs#L463-L474)).
Put anything else on that input and whichever goo Grasshopper orders first wins; if it isn't the
schema, the plugin silently serves a blank default schema instead of the authored one.

### 2. One ContextBake carries exactly one output

`BuildFirstInputPayload` classifies **the first recognized goo** on the bake's first input and
returns
([ValueCollector.cs:417-433](../../Plugin/Selva.GH/Features/UIBuilder/Services/ValueCollector.cs#L417-L433)).
`SchemaOutput` holds a single scalar `TargetInputId`, and `FindUpstreamDynamicValueListOutput`
returns on its first hit
([ParameterTypeHelper.cs:167-184](../../Plugin/Selva.GH/Features/UIBuilder/Helpers/ParameterTypeHelper.cs#L167-L184)).

So N `Set Dynamic Value List` components feeding one bake collapse to **one** output, whose target
is whichever source Grasshopper happens to order first. The other N−1 routes are structurally
unrepresentable. No warning is emitted.

**Three DVLs need three bakes.** Same for files and charts.

### 3. The output identity is the ContextBake's GUID, never the Set component's

`schema.outputs[].id` must be the **bake's** `InstanceGuid`. `ValueCollector` resolves
`document.FindObject(output.Id)` and reads that object's first input
([ValueCollector.cs:72-92](../../Plugin/Selva.GH/Features/UIBuilder/Services/ValueCollector.cs#L72-L92)).
Point it at the `Set Dynamic Value List` component instead and it resolves that component, whose
first input is the **`Options` text param** — producing the diagnostic:

```
[ValueCollector] ContextBake 'Set DynVL' output: UnknownType('Text')
```

`UnknownType('Text')` on a Set-named node is the signature of exactly this mistake.

Nothing repairs it. `PurgeStaleReferences` only checks that the GUID resolves to _some_ document
object, not that it is a bake
([SchemaSynchronizer.cs:762](../../Plugin/Selva.GH/Features/UIBuilder/Services/Schema/SchemaSynchronizer.cs#L762)),
and the post-solve remove branch only considers IDs that already _are_ bakes — so a wrong-kind
output entry is invisible to both and survives indefinitely.

### 4. `paramType` is camelCase, is never validated, and is never repaired

Valid values ([ui-schema.json:13-23](../../packages/schemas/ui-schema.json#L13-L23)): `number`,
`integer`, `boolean`, `text`, `valueList`, `dynamicValueList`, `file`, `color`, `generic`.

`valueList` and `dynamicValueList` are **different types**. There is no case normalization anywhere
in the plugin, and `ParameterValidationRule` only checks for emptiness — so `"ValueList"` or
`"Number"` deserializes clean and is silently wrong. Concretely, a PascalCase `paramType` means:

- `ValueApplicator`'s `skipDedup` for `dynamicValueList` never fires, so a re-sent selection is
  deduped away and the output freezes on the previous solve's value
  ([ValueApplicator.cs:94](../../Plugin/Selva.GH/Features/UIBuilder/Services/ValueApplicator.cs#L94))
- numeric coercion is bypassed

And it is permanent: `MergeDiscoveredInputs` skips any ID already present in `schema.Inputs`
([SchemaSynchronizer.cs:811](../../Plugin/Selva.GH/Features/UIBuilder/Services/Schema/SchemaSynchronizer.cs#L811)),
so `paramType` is written once at first discovery and never re-derived.

Validate a payload before grafting it:

```bash
node .claude/skills/rhino-mcp/validate-ui-schema.mjs <file.json>
```

## What the UI Bridge creates by itself

Dropping a UI Bridge on a fresh canvas yields **three objects and two wires**: the Bridge, a
Boolean Toggle wired into `Enable`, and a ContextBake whose input is renamed to `Schema` and wired
from the `Schema` output
([WireDefaultNeighbors](../../Plugin/Selva.GH/Features/UIBuilder/Components/GH_UIBuilderComponent.cs#L579-L637)).

It is gated on `IsFreshPlacement()`
([:554-577](../../Plugin/Selva.GH/Features/UIBuilder/Components/GH_UIBuilderComponent.cs#L554-L577)) —
skipped when the component carries an embedded schema, when `Enable` already has a source, or when
`Schema` already has a recipient. Each side is wired independently, so a half-wired Bridge gets
only the missing half and never a duplicate toggle.

Two consequences worth knowing:

- Placing the toggle and bake yourself _as well_ gives 5 objects and duplicate wires into `Enable`.
  Place only the Bridge. For a bare placement, wrap `AddObject` in
  `GH_UIBuilderComponent.SuppressAutoWire()` (`[ThreadStatic]`; also used by the version upgrader,
  which would otherwise auto-wire a second toggle mid-swap).
- `HasSchemaRecipient()` asks only whether the `Schema` output has _any_ recipient — not whether it
  reaches a correctly-nicknamed bake. Wiring `Schema` into a value bake satisfies the gate while
  breaking rule 1.

## Who owns which field

`SchemaOutput.Nickname` is **not** authorable. Grasshopper is authoritative, and four independent
paths rewrite it from `Params.Input[0].NickName` — metadata detect, `SyncNicknamesFromDocument`,
the post-solve bake merge, and `ApplyFromGH`. Authoring distinct names in `outputs[]` does not
survive one solve.

To label outputs, name the **bake's input param** distinctly, or set `DisplayName` on a layout item
— `ApplyMetadataChangesToSchema` deliberately leaves `DisplayName` alone as user-controlled.

`targetInputId` lives in three places, and the **Grasshopper component is the real source of
truth**. On schema save, `ApplyParameterAccessFromSchema` walks each
`OutputDynamicValueListLayoutItem`, resolves its `ParamId` → the ContextBake → up to the Set
component, and writes `TargetInputId` onto the live component
([SchemaSynchronizer.cs:612-624](../../Plugin/Selva.GH/Features/UIBuilder/Services/Schema/SchemaSynchronizer.cs#L612-L624)).
The next solve reads it back out into `schema.outputs[]`.

Two consequences:

- That write-back keys on the **layout item**, and its `ParamId` must be the **bake's** GUID. A
  schema with no layout item for a DVL output — or one keyed on the Set component — never receives
  the target, so it can only come from what's already archived in the `.ghx`.
- `SchemaOutputCanonicalizer` mirrors layout → outputs one-way and **skips IDs that already
  exist**, so editing a layout item's target does not update an existing output row directly. It
  only lands via the Grasshopper round-trip above.

A Set component with no target posts a Remark telling the author to set it in the UI builder; the
write-back expires the component directly so that stale remark clears.

## Goo `TypeName` strings

Classification matches these verbatim — casing and spacing included. `"Dynamic Value List"` has
spaces; `"ValueList"` and `"FileData"` do not.

| Goo                   | `TypeName`           | Notes                                               |
| --------------------- | -------------------- | --------------------------------------------------- |
| `UISchemaGoo`         | `UISchema`           | What the `Schema` output emits                      |
| `DynamicValueListGoo` | `Dynamic Value List` |                                                     |
| `GH_ValueListDataGoo` | `ValueList`          | The _static_ value list — a different type from DVL |
| `FileDataGoo`         | `FileData`           |                                                     |
| `FileInputGoo`        | `FileInput`          |                                                     |
| `WebDisplayGoo`       | `WebDisplay`         |                                                     |
| `ThreeMaterialGoo`    | `ThreeMaterial`      |                                                     |
| _(none — external)_   | `Plotly Figure`      | Belongs to **Selva Canopy**, matched by string only |

`Get Dynamic Value List` deliberately reuses `TypeName == "ValueList"`. Schema discovery therefore
resolves `paramType` from the **CLR class-name substring**, not `TypeName`, and the keyword table
must keep `DynamicValueList` ahead of `ValueList` or every dynamic list resolves as static.

`ISelvaSerializableGoo` is the Compute contract: one `ToComputeJson()` method, matched by the
Rhino.Compute fork **by simple name, never assembly identity** — so a new output goo needs no fork
change.

## Two names the code depends on that no compiler checks

Rhino.Compute reflects on the literal class name `GH_UIBuilderComponent` and the private field name
`_embeddedSchema` to serve `/grasshopper/schema` without solving
([GH_UIBuilderComponent.cs:23-46](../../Plugin/Selva.GH/Features/UIBuilder/Components/GH_UIBuilderComponent.cs#L23-L46)).
Renaming either compiles clean and makes every definition report "no embedded schema". Nothing in
either repo catches it.

Similarly, `ContextBakeComponent`, `ContextPrintComponent`, and `GetNumberParameter` are **external
Hops/Compute types** matched by literal `GetType().Name` — they do not exist in this repo. `Bake
Files` shares the purple accent styling but is _not_ a ContextBake.

## Debugging live in Rhino

**`Logger.Log` is `#if DEBUG`**
([Logger.cs:8-13](../../Plugin/Selva.GH/Utilities/Helpers/Logger.cs#L8-L13)). Every `[ValueCollector]`
classification line — the most useful signal for a missing output — is **silent in a Release
`.gha`**. `Logger.Warn` and `Logger.Error` always fire.

There are also two sinks: the ContextBake _output_ walk logs via `Logger.Log` to the Rhino command
line, while the ContextBake _display_ walk logs via `Debug.WriteLine`, visible only in
VS/DebugView.

Reading the output diagnostic:

| Line                        | Meaning                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Empty`                     | The bake's first input had no data — wiring or solve order                                                         |
| `UnknownType('X')`          | A goo was present but matched no Selva type — unwrap miss, or `output.Id` points at the wrong object kind (rule 3) |
| `Matched(type, 'TypeName')` | A payload was produced; look downstream in TypeScript                                                              |

A blind spot worth knowing: when the component is busy, inbound value updates are merged into a
pending buffer and applied later with **no log line at all**
([BridgeOrchestrator.cs:105-115](../../Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs#L105-L115)).
Values appearing to "not apply" often land one solve later.

## Editing a fixture by hand

`InstanceGuid`s are load-bearing: the embedded schema keys inputs and outputs on them. Re-placing a
param changes its GUID and silently desyncs the schema — update both together.

A rebuild drops authored state that the graph structure doesn't carry: a freshly-placed UI Bridge
reads "Offline • No Schema", its `Container` chunk loses the `Schema` item, and nicknames revert
(`UI Bridge` → `UIBridge`). C# script bodies live in each component's own `Script` chunk and are
not reachable through the MCP script sandbox at all — those fixtures must be hand-edited.

Before overwriting a committed fixture, diff for dropped items:

```bash
git show HEAD:path/to/fixture.ghx > /tmp/old.ghx
diff <(grep -oE '<item name="[^"]+"' /tmp/old.ghx | sort -u) \
     <(grep -oE '<item name="[^"]+"' path/to/fixture.ghx | sort -u)
```

A missing `<item name="Schema"` means the fixture is degraded — don't commit it.

## No test covers any of this

Nothing in `Plugin/Selva.Tests` pins the `"Schema"` nickname coupling, bake counts, or fixture
wiring. The write at `GH_UIBuilderComponent.cs:624` and the reads at `BridgeOrchestrator.cs:449`
and `:470` are joined by a repeated string literal and nothing else. The source says so itself:

> Context Bake wiring. Nothing in either repo catches this: the boundary has no test.

`OutputPayloadContractTests` and `SchemaOutputCanonicalizerTests` do pin the payload contract and
the `{file, chart, dynamicValueList}` output-type set — but they run without a Grasshopper runtime,
so they cannot see topology.

## Worked example: `fixtures/grasshopper/fixture_dynamic_value_list.ghx`

Repaired against these rules; its four original defects are a checklist of what each rule catches.

The fixture as committed had all three `Set DynVL` outputs on one bake (rule 2 — only `dvlSelect`
was ever surfaced), `schema.outputs[]` keyed on the **Set component** GUIDs (rule 3 — the source of
its `UnknownType('Text')` on every solve), `paramType: "ValueList"` on all three DVL inputs (rule 4
— silently disabling the dedup-skip the whole definition depends on), and no schema bake at all,
which the plugin papered over by scaffolding one on load.

The repaired topology is **22 objects, 4 ContextBakes**:

| Bake              | input[0] nickname   | Carries                                  |
| ----------------- | ------------------- | ---------------------------------------- |
| `Context Bake`    | `Schema`            | UI Bridge `Schema` output — nothing else |
| `Bake steady`     | `steadyOptions`     | `Set DynVL` → `dvlSelect`                |
| `Bake convergent` | `convergentOptions` | `Set DynVL` → `dvlConvergent`            |
| `Bake oscillate`  | `oscillateOptions`  | `Set DynVL` → `dvlOscillate`             |

Each group in the layout carries an `OutputDynamicValueListLayoutItem` whose `paramId` is the bake
and whose `config.targetInputId` is the Get param — without it the write-back in "Who owns which
field" never runs.

Two traps that cost a save cycle here:

- **`_selectedValues` is wiped by any solve.** `ClearAllContextualParameters` runs at every
  solve-end, so a fixture whose saved selections matter must have them re-applied
  (`SelectItemByName`) immediately before writing the archive, with no solve in between.
- The `Could not write schema history: Method not found: JToken.ToString` warning on save is a
  Newtonsoft mismatch in the MCP script sandbox. It affects only the optional history backup — the
  `Schema` item is written correctly. Confirm with the item diff above rather than trusting it.
