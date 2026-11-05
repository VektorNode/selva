# Grasshopper plugin context

How the Grasshopper plugin's pieces actually fit together: the wiring rules and identity
invariants that decide whether a definition works.

How to author a definition (what each component is, where it sits on the ribbon, how to wire one
up) is covered by video rather than prose. This file is the layer underneath: the rules a tool or
a person editing a `.ghx` by hand has to honour, and the traps that fail silently.

**Everything here fails silently.** No exception, no red component, no validation error. The
symptom is a blank UI, a stale value, or an output that never appears.

## The four identity rules

### 1. The schema needs its own ContextBake, nicknamed `Schema`

The UI Bridge finds its schema bake by walking its own `Schema` output's recipients and requiring
**`bake.Params.Input[0].NickName == "Schema"`**, ordinal and case-sensitive
(`FindWiredContextBake` in
[BridgeOrchestrator.cs](../../Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs)).
Miss it and the plugin refuses to serve the UI at all:

> UIBridge Schema output is not connected to a Context Bake component with param name "Schema".
> Wire it up in Grasshopper first.

Schema saves are rejected on the same check. The stock Hops bake ships as `Content`/`Content`; the
`Schema` nickname is written **only** by the auto-scaffold path (`WireDefaultNeighbors` in
[GH_UIBuilderComponent.cs](../../Plugin/Selva.GH/Features/UIBuilder/Components/GH_UIBuilderComponent.cs)),
so a hand-placed bake keeps `Content` and does not qualify.

**Value goos must not share that bake.** `ReadSchemaFromContextBake` takes the `Schema`-nicknamed
input's `AllData(true).FirstOrDefault()` and tests `data is UISchemaGoo`: first goo wins, no search.
Put anything else on that input and whichever goo Grasshopper orders first wins. If it isn't the
schema, `HandleClientConnected` ignores the bake and falls back to the schema embedded in the Bridge,
then to a blank default.

### 2. One ContextBake carries exactly one output

`ValueCollector.BuildFirstInputPayload`
([ValueCollector.cs](../../Plugin/Selva.GH/Features/UIBuilder/Services/ValueCollector.cs))
classifies **the first recognized goo** on the bake's first input and returns. `SchemaOutput`
holds a single scalar `TargetInputId`, and `FindUpstreamDynamicValueListOutput` returns on its first hit
([ParameterTypeHelper.cs](../../Plugin/Selva.GH/Features/UIBuilder/Helpers/ParameterTypeHelper.cs)).

So N `Set Dynamic Value List` components feeding one bake collapse to **one** output, whose target
is whichever source Grasshopper happens to order first. The other N−1 routes are structurally
unrepresentable. No warning is emitted.

**Three DVLs need three bakes.** Same for charts. Files differ: `CollectFileOutputs` sends every
`FileData` on the bake as one list.

File and DVL bakes qualify through wires and relays, or by holding the goo after a solve. So either
one routed through Merge, Dispatch or any other data-passing component only shows up after that
solve.

### 3. The output identity is the ContextBake's GUID, never the Set component's

`schema.outputs[].id` must be the **bake's** `InstanceGuid`. `ValueCollector.CollectOutputValues`
resolves `document.FindObject(output.Id)` and reads that object's first input. Point it at the
`Set Dynamic Value List` component instead and it resolves that component, whose first input is the
**`Options` text param**, producing the diagnostic:

```
[ValueCollector] ContextBake 'Set DynVL' output: UnknownType('Text')
```

`UnknownType('Text')` on a Set-named node is the signature of exactly this mistake.

Nothing repairs it. `PurgeStaleReferences` only checks that the GUID resolves to _some_ document
object, not that it is a bake
([SchemaSynchronizer.cs](../../Plugin/Selva.GH/Features/UIBuilder/Services/Schema/SchemaSynchronizer.cs)),
and the post-solve remove branch of `MergePostSolveBakeOutputs` only considers IDs that already
_are_ bakes, so a wrong-kind output entry is invisible to both and survives indefinitely.

### 4. `paramType` is camelCase, is never validated, and is never repaired

Valid values: the `ParamType` enum in [ui-schema.json](../../packages/schemas/ui-schema.json).
`geometry`, `point`, `line` and `plane` come from Rhino's own Get Geometry, Get Point, Get Line and
Get Plane. The hosts pick their control from `paramType` and ignore the saved `widgetType`, which
is the placeholder `text`; the page never sends a value for them, and the bridge reports only what a
viewport pick holds.

`valueList` and `dynamicValueList` are **different types**. Nothing in the plugin normalizes case,
and `ParameterValidationRule` only checks for emptiness, so `"ValueList"` or `"Number"`
deserializes clean. It fails later, when a value is applied: `ValueApplicator` matches `paramType`
exactly, so a PascalCase value reaches `Unsupported parameter type: Number`, which is logged and
broadcast to the UI as a runtime message. Nothing marks the component on the canvas, and the value
never lands.

And it is permanent: `MergeDiscoveredInputs` skips any ID already present in `schema.Inputs`, so
`paramType` is written once at first discovery and never re-derived.

Validate a payload before grafting it:

```bash
node ~/.claude/skills/rhino-mcp/validate-ui-schema.mjs <file.json>
```

## What the UI Bridge creates by itself

Dropping a UI Bridge on a fresh canvas yields **three objects and two wires**: the Bridge, a
Boolean Toggle wired into `Enable`, and a ContextBake whose input is renamed to `Schema` and wired
from the `Schema` output (`WireDefaultNeighbors`, called from `AddedToDocument`).

It is gated on `IsFreshPlacement()`: skipped when the component carries an embedded schema, when
`Enable` already has a source, or when `Schema` already has a recipient. Each side is wired
independently, so a half-wired Bridge gets only the missing half and never a duplicate toggle.

Two consequences worth knowing:

- Placing the toggle and bake yourself _as well_ gives 5 objects and duplicate wires into `Enable`.
  Place only the Bridge. For a bare placement, wrap `AddObject` in
  `GH_UIBuilderComponent.SuppressAutoWire()` (`[ThreadStatic]`; also used by the version upgrader,
  which would otherwise auto-wire a second toggle mid-swap).
- `HasSchemaRecipient()` asks only whether the `Schema` output has _any_ recipient, not whether it
  reaches a correctly-nicknamed bake. Wiring `Schema` into a value bake satisfies the gate while
  breaking rule 1.

## Who owns which field

`SchemaOutput.Nickname` is **not** authorable. Grasshopper is authoritative: metadata detection
(`ApplyMetadataChangesToSchema`), `SyncNicknamesFromDocument` and the sync dialog's from-Grasshopper
direction (`ApplyFromGH`) all rewrite it from `Params.Input[0].NickName`. `MergePostSolveBakeOutputs`
only seeds a nickname on a newly added output. Authoring distinct names in `outputs[]` does not
survive the next sync.

To label outputs, name the **bake's input param** distinctly, or set `DisplayName` on a layout item;
`ApplyMetadataChangesToSchema` deliberately leaves `DisplayName` alone as user-controlled.

A value list's `options` belong to Grasshopper and are replaced on every sync; its `optionMedia`
belongs to the author, and both syncs merge `options` into the config without touching it. Media
is keyed by option name, so renaming an option in Grasshopper drops its icon.

`targetInputId` lives in three places, and the **Grasshopper component is the real source of
truth**. On schema save, `ApplyParameterAccessFromSchema` walks each
`OutputDynamicValueListLayoutItem`, resolves its `ParamId` → the ContextBake → up to the Set
component, and writes `TargetInputId` onto the live component. The next solve reads it back out
into `schema.outputs[]`.

Two consequences:

- That write-back keys on the **layout item**, and its `ParamId` must be the **bake's** GUID. A
  schema with no layout item for a DVL output, or one keyed on the Set component, never receives
  the target, so it can only come from what's already archived in the `.ghx`.
- `SchemaOutputCanonicalizer` mirrors layout → outputs one-way and **skips IDs that already
  exist**, so editing a layout item's target does not update an existing output row directly. It
  only lands via the Grasshopper round-trip above.

## Goo `TypeName` strings

The plugin string-matches a goo's `TypeName` in three places, verbatim, casing and spacing
included: `Dynamic Value List` (with spaces) and `FileData` in `ParameterTypeHelper`, for goos that
reach a bake through data-passing components, and `Plotly Figure` in `ValueCollector`. `Plotly Figure`
belongs to **Selva Canopy**, so there is no class to match. Every other goo is matched by CLR type;
its `TypeName` only surfaces in diagnostics such as `UnknownType('X')`.

`Get Dynamic Value List` deliberately reuses `TypeName == "ValueList"`. Schema discovery therefore
resolves `paramType` from the **CLR class-name substring**, not `TypeName`, and the
`ParameterTypeKeywords` table in `SchemaSynchronizer` must keep `DynamicValueList` ahead of
`ValueList` or every dynamic list resolves as static.

Rhino.Compute's side of the goo contracts is explained in the class comments of
`ISelvaSerializableGoo` (matched by the fork **by simple name, never assembly identity**) and
`SelvaContextualParameter<T>`. For the latter: the fork hands any contextual param whose `TypeName`
it doesn't list the request's values as text through `AssignContextualDataTree(DataTree<GH_String>)`.
Change that tree type and Compute silently stops assigning the param; add an overload and the
fork's by-name lookup throws.

## Names the code depends on that no compiler checks

Rhino.Compute reflects on the class name `GH_UIBuilderComponent` and the private field
`_embeddedSchema`; the DO NOT RENAME comments on both say why.

`ContextBakeComponent`, `ContextPrintComponent` and `GetNumberParameter` are **external
Hops/Compute types** matched by literal `GetType().Name`; they do not exist in this repo. `Bake
Files` shares the purple accent styling but is _not_ a ContextBake.

## Debugging live in Rhino

**`Logger.Log` is `#if DEBUG`**
([Logger.cs](../../Plugin/Selva.GH/Utilities/Helpers/Logger.cs)). Every `[ValueCollector]`
classification line, the most useful signal for a missing output, is **silent in a Release
`.gha`**. `Logger.Warn` and `Logger.Error` always fire.

The ContextBake _display_ walk logs through `Debug.WriteLine` instead, which is compiled out of
Release too; in a Debug build it shows only in VS/DebugView, not on the Rhino command line.

The output diagnostic reads `Empty` (the bake's first input had no data: wiring or solve order),
`UnknownType('X')` (a goo was present but matched no Selva type: an unwrap miss, or `output.Id`
points at the wrong object kind, rule 3) or `Matched(type, 'TypeName')` (a payload was produced; look
downstream in TypeScript).

A blind spot worth knowing: when the component is busy, inbound value updates are merged into a
pending buffer and applied later with **no log line at all**
(`HandleWebSocketValueUpdate` in `BridgeOrchestrator`). Values appearing to "not apply" often land one
solve later.

## Laying out a form from a script

`SchemaLayout` lays the form out by parameter nickname, so a script or an agent never handles a
GUID. Both calls take and return JSON text, so Rhino MCP's `run_csharp`, which cannot name Selva's
types, reaches them by reflection:

```csharp
var layout = AppDomain.CurrentDomain.GetAssemblies().First(a => a.GetName().Name == "Selva")
    .GetType("Selva.GH.Features.UIBuilder.Services.Schema.SchemaLayout");
var spec = (string)layout.GetMethod("Read").Invoke(null, new object[] { doc });
var result = (string)layout.GetMethod("Apply").Invoke(null, new object[] { doc, spec });
```

```jsonc
{
	"name": "Wall cap",
	"tabs": [
		{
			"label": "General",
			"groups": [
				{
					"label": "Size",
					"items": [
						"Width",
						{ "param": "Angle", "label": "Slope", "config": { "minimum": 0, "maximum": 45 } },
						{ "linebreak": true }
					]
				}
			]
		}
	]
}
```

- The spec is the whole layout. What it leaves out is dropped, and the inputs no item shows come
  back as `unplaced`.
- An item keeps whatever the spec does not give from the item already there (`config` merges key
  by key), else takes it from the canvas: a value list's options, a getter's range. The widget
  follows the param type unless `widget` names one.
- `description` and `default` set the input's too. Visibility rules take `param` for `paramId`.
- A value list's `options` always come from the canvas. A rule on one must name an option's value as a
  string, or the spec is refused: the page compares strictly, so a typo or a bare number would be a
  rule that never holds.
- `assets` and `viewerOptions` sit at the root. `assets` adds to what the schema holds; `config.optionMedia`
  in the same spec can use them. `Read` returns `viewerOptions` but not `assets`.
- Unknown keys are errors, and any error refuses the whole spec with nothing changed.
- The document must have solved once, or Context Bake outputs are not known yet.

## Editing a fixture by hand

`InstanceGuid`s are load-bearing: the embedded schema keys inputs and outputs on them. Re-placing a
param changes its GUID and silently desyncs the schema: update both together.

A rebuild drops authored state that the graph structure doesn't carry: a freshly-placed UI Bridge
reads "Offline • No Schema", its `Container` chunk loses the `Schema` item, and nicknames revert
(`UI Bridge` → `UIBridge`). C# script bodies live in each component's own `Script` chunk and are
not reachable through the MCP script sandbox at all; those fixtures must be hand-edited.

Before overwriting a committed fixture, diff for dropped items:

```bash
git show HEAD:path/to/fixture.ghx > /tmp/old.ghx
diff <(grep -oE '<item name="[^"]+"' /tmp/old.ghx | sort -u) \
     <(grep -oE '<item name="[^"]+"' path/to/fixture.ghx | sort -u)
```

A missing `<item name="Schema"` means the fixture is degraded: don't commit it.

## No test covers any of this

Nothing in `Plugin/Selva.Tests` pins the `"Schema"` nickname coupling, bake counts, or fixture
wiring. `WireDefaultNeighbors` writes the nickname and `FindWiredContextBake` and
`ReadSchemaFromContextBake` read it, joined by a repeated string literal and nothing else.

`OutputPayloadContractTests` and `SchemaOutputCanonicalizerTests` do pin the payload contract and
the `{file, chart, dynamicValueList}` output-type set, but they run without a Grasshopper runtime,
so they cannot see topology.

## Worked example: `dev/grasshopper/dynamic-value-list.ghx`

23 objects (20 excluding groups) and 4 ContextBakes: `Context Bake` (input `Schema`) carries the UI
Bridge `Schema` output and nothing else, and `Bake steady`, `Bake convergent` and `Bake oscillate`
(inputs `steadyOptions`, `convergentOptions`, `oscillateOptions`) each carry one `Set DynVL`, targeting
`dvlSelect`, `dvlConvergent` and `dvlOscillate`. Each group in the layout carries an
`OutputDynamicValueListLayoutItem` whose `paramId` is the bake and whose `config.targetInputId` is
the Get param; without it the write-back in "Who owns which field" never runs.

Two traps that cost a save cycle here:

- **The applied selection is wiped by any solve.** `ClearAllContextualParameters` runs at every
  solve-end, so a fixture whose saved selections matter must have them re-applied
  (`SelectItemByName`) immediately before writing the archive, with no solve in between.
- The `Could not write schema history: Method not found: JToken.ToString` warning on save is a
  Newtonsoft mismatch in the MCP script sandbox. It affects only the optional history backup; the
  `Schema` item is written correctly. Confirm with the item diff above rather than trusting it.
