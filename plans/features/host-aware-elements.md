# One schema, two hosts: geometry inputs, triggers and bake

Sibling of [rhino-player](./rhino-player.md).

A Selva UI runs in two hosts:

- the plugin's page inside Rhino, where the definition solves in the user's own Grasshopper;
- the Selva app, where it solves headless on Rhino.Compute.

Some things only make sense in one of them today. Picking a curve in the viewport or baking a
result needs a Rhino document with a person in front of it. Over time most of them should work in
both.

## The decision

**The schema says what an element needs from the user, never which host supplies it.** Each host
renders the elements it can and hides the rest. Making an element work on Selva later means Selva
gains a renderer: no schema change, and no migration of saved definitions.

- **One table in `@selvajs/ui` says which element kinds each host renders.** It is worked out from
  `paramType`, `widgetType`, widget config and `source.kind`, and the builder, the plugin preview and
  the Selva renderer all read it. It isn't stored in the schema. A stored derived value goes stale,
  the way `paramType` is written once at discovery and never re-derived
  ([plugin-context, rule 4](../../docs/contributing/plugin-context.md#4-paramtype-is-camelcase-is-never-validated-and-is-never-repaired)).
- **The builder shows the gaps.** It badges an element a host can't render ("Not on Selva yet"),
  sums up where the UI runs, and warns on Upload to Selva. A gap reads as unfinished work, because
  it is.
- **Hidden still solves, with the definition's own default.** Selva seeds every input with
  `input.default ?? getDefaultValue(paramType)` and sends them all, and the server falls back to
  `input.default` again. For a geometry input, `input.default` is whatever Compute's `/io` reported,
  merged in by `mergeComputeDefaults`. Either Selva sends that back, or there's no default,
  `TreeBuilder.fromValues` omits the input, and Grasshopper uses the Get component's own value.
  Both should come to the same internalised geometry; that's a gate below.

The schema already works this way in two places. `viewerOptions.enableLocal` and `enableRemote`
configure the viewer per host, and `InputSource.kind: "server"` is something only Selva can fill.

## What happens today

Rhino's stock contextual inputs are already discovered. Selva's `ResolveParameterTypeName`, called
live on each stock param (Rhino 8.27, Selva 0.23), gives:

| Component                 | `paramType` today                                          |
| ------------------------- | ---------------------------------------------------------- |
| Get Geometry              | `geometry`                                                 |
| Get Point                 | `point`                                                    |
| Get Line                  | `line`                                                     |
| Get Plane                 | `plane`                                                    |
| Get Object (Model Object) | `generic`                                                  |
| Get File Path             | `file`: wrong, it's a path string, not Selva's file upload |

`paramType` is a plain string on both stacks and nothing validates it. Of those values only `file`
and `generic` are in the `ParamType` enum in `packages/schemas/ui-schema.json`. Downstream:

- **Builder:** `mapParamTypeToWidgetType` sends unknown types to its default branch, so a Get
  Geometry becomes a text box. The builder is the only place a `widgetType` is chosen; the plugin
  never creates layout items.
- **Plugin:** a value typed into that box reaches `ValueApplicator`, which has no handler for
  `geometry` and warns "Unsupported parameter type".
- **Echo:** `PopulateInputDefault` reads the param's volatile data first, and a Rhino geometry
  object serialises as Rhino's archive JSON (`version`, `archive3dm`, `opennurbs`, base64 `data`;
  checked live). The page seeds its value from that default, `ValueCollector` reports geometry as
  `ToString()`, and the page resends its whole value set on every solve. Today the geometry goes
  round in a loop and ends at that warning.
- **Selva:** the schema passes through unvalidated (stored as `z.record(z.string(), z.unknown())`).
  `InputControl.svelte` would render a label and no control for an unknown widget type. As things
  stand, the saved `text` widget sends a string where Compute expects geometry.

**Rhino 8 has no Get Curve or Get Brep.** A curve input is a Get Geometry (or Get Object) whose type
filter, set from its context menu, allows only curves. At runtime the filter is a private
`ObjectTypeFilter` property, defaulting to every geometry type. In the `.gh` it is saved as the
param's `Filter` item.

**An older plugin silently drops a schema with a layout item it doesn't know.**

- `MigrateWithTracking` passes a newer minor version through unchanged, and `ValidateCompatibility`
  only refuses a newer major.
- The layout-item converter throws "Unknown LayoutItem variant".
- That happens in `jObject.ToObject<UISchema>()`, before the `minPluginVersion` check runs.
- `Read()` keeps going with no schema, and the next save writes no `Schema` item.

So every new layout-item variant is a hazard for anyone on an older plugin, such as a colleague, or
a Compute server that hasn't been updated.

## Geometry inputs

**Scope:** Get Geometry, Get Point, Get Line and Get Plane. These are Rhino's own components, so
Selva adds no Grasshopper component and changes no param list, and the plugin already gives them
the right `paramType`.

Get Object (Model Objects, which carry layer and attributes) comes later. Saved Get Object inputs
already hold `generic`, and an existing input's `paramType` is never re-derived. The Get File Path
mapping is a separate bug with the same cause. Both need `paramType` re-derived from the document on
sync, as nicknames are.

**No new layout-item variant, no migration and no version bump.** The hosts pick the geometry
control from `paramType` (`geometry`, `point`, `line`, `plane`), whatever the saved `widgetType`
says. That fixes saved definitions, which hold `widgetType: "text"` for these inputs, without
rewriting them. It also stays clear of the older-plugin hazard above. In the schema:

- **`ParamType` gains the four values.** The builder maps them to the geometry control, and so does
  the dev mock, which repeats the mapping (`mock-grasshopper.ts`).
- **The enum list in plugin-context.md rule 4 is updated in the same change.**
- **One object or several** comes from discovery's `atMost`, which the label uses ("Pick a curve" or
  "Pick curves"). `SchemaInput.inputStructure` isn't filled from the param (`MergeDiscoveredInputs`
  hardcodes `item`), so it isn't used. The param's own `AtLeast`/`AtMost` govern the pick itself.
- **Mode config waits for upload.** Upload (`.3dm`, later) is the step that needs a config
  (`allowedInputModes`, shaped like the file input's) and the type filter in the schema. It arrives
  as a new variant or field once the tolerant converter (step 0 below) has been out long enough.

|       | Pick  | Upload `.3dm` |
| ----- | ----- | ------------- |
| Rhino | first | later         |
| Selva | never | later         |

**Pick in Rhino.**

1. The page sends `pickGeometry { requestId, paramId }`. A second message, `clearGeometry
{ paramId }`, empties the input again.
2. The plugin, on the UI thread and only while no solve runs, builds a
   `GH_ParameterContext(name, doc, RunMode.Interactive)` and calls the param's
   `AutoAssignContextualData` with it. That is the entry Grasshopper Player uses. The param applies
   its own type filter, prompt, `AtLeast`/`AtMost`, the live preview of Get Point, Line and Plane,
   and its delete-input option, so Selva reimplements none of it.
3. The reply is `pickGeometryResult { requestId, outcome: picked | cancelled | failed, summary }`.
   The summary is a count and a type label, such as "2 curves", with Pick again and Clear.

While the pick runs, the page says "Pick in the viewport, Esc to cancel".

**The picked geometry stays on the param.**

- **Nothing on the page resends it.** Typed values survive the bridge's post-solve
  `ClearAllContextualParameters` only because the page resends its whole value set on every solve.
  A pick has no resender.
- **So picked params are exempt from that clear.** Their contextual data stays until Clear, a new
  pick, or the end of the session (`HandleDisablingState` already clears every contextual param).
- **It never reaches the `.gh`.** Grasshopper doesn't write contextual data into the archive:
  checked live, a Get Geometry writes the same items with and without it. It also stays out of
  `ValueApplicator`'s `_lastAppliedValues`, which `Write()` saves as the `Values` item.
- **When the file is reopened**, the param falls back to the author's internalised default.

**Geometry inputs drop out of the value loop.**

- `PopulateInputDefault` skips them.
- `ValueCollector` reports the summary instead of `ToString()`.
- The page never sends a value for them.

Otherwise, after a pick, the "default" read from volatile data would be the picked geometry,
echoed back on every solve.

The pick is a snapshot. Following picked objects live can come later as an option, for local
sessions only.

## Trigger button

A boolean input shown as a button. It's the cheapest local action and covers the most, because the
definition does the action itself: a Rhino 8 Model Object bake, Bake Files, an export.

- **Schema:** `CheckboxWidgetConfig.displayAs: "button"`, like `DropdownWidgetConfig.displayAs` and
  `NumberWidgetConfig.renderAsSlider`. It isn't a new variant. An older plugin ignores the unknown
  key and shows a checkbox. If it re-saves, the key is dropped and the button goes back to being a
  checkbox, which is a much smaller loss than the whole schema. The builder needs a
  checkbox/button switch in the item's config; there is no input widget switcher today.
- **A press is a message, not a value.** The page sends `trigger { paramId }` and keeps no value
  for the input. Holding `true` in the page's values would resend it on every solve and fire the
  action again on the next slider move. Presets skip button inputs for the same reason.
- **The reset has to land in the param's data.** The plugin assigns `true` and solves. At that
  solve's end it swaps the param's volatile data for `false` in place, without expiring anything.
  Clearing the contextual data isn't enough: the param's volatile data stays `true`, and the action
  would fire again the next time anything downstream recomputes. Expiring the param is too much:
  that clears everything downstream, so the press's own results leave the viewport and the Context
  Bakes. A second solve straight away, like Grasshopper's Button, would cost a full solve to undo
  nothing.
- **Rhino only for now.** On Selva a press is a solve with `true` in it. Three caches can answer a
  repeat press without solving: the request-response driver's memo, the server's cache, and
  Compute's `cachesolve`. And a side effect on the Compute server isn't something the user can get
  at. The Environment component already lets a definition tell the two hosts apart.

## Bake to Rhino

This needs its own design pass before it's built. What's known:

- **Selva can't use Context Bake for baking.** Selva uses Context Bake to mark outputs, so it can't
  also be the thing that bakes, which it is in Grasshopper Player.
- **Bake can't be an output type picked from what a Context Bake carries.** Every viewer Context
  Bake carries geometry, and qualifying bakes are added to `schema.Outputs` automatically after each
  solve, so a `geometry` output type would sweep in every display bake. `ClassifyBakeOutputType`
  qualifies only file, chart and dynamic value list outputs, and a test pins that set
  (`SchemaOutputCanonicalizer.BakeOutputTypes`).
- **So bake needs an explicit opt-in**, such as a dedicated Selva component or a bake option on a
  display output.
- **The candidate mechanism is Grasshopper's own bake** (`IGH_BakeAwareObject` /
  `IGH_BakeAwareData`, also reachable as `GH_RhinoScriptInterface.BakeDataInObject`), rather than
  creating Rhino objects by hand.
- **The behaviour:** no re-solve, one undo step, attributes from Model Objects when present. Each
  bake adds objects; "replace the previous bake" comes later as an option. On Selva it's hidden for
  now, and later becomes a `.3dm` download.

## Order of work, and why

0. **Make the plugin tolerant of layout items it doesn't know**, and check `minPluginVersion` on the
   raw JSON in `MigrateJson`, before typed deserialization. An unknown item round-trips its raw JSON
   unchanged on save. This ships first and on its own, because every later variant (upload config,
   bake) depends on plugins in the field being able to survive it. Plugins from before this step
   still drop such a schema. Nothing can reach them, so the release notes say so.
1. **Geometry as geometry everywhere:**
   - the enum, plus the builder and dev-mock mapping;
   - hosts choosing the control from `paramType`;
   - the support table and badges;
   - geometry dropped from the value loop;
   - the rules editor offering no operators for geometry inputs, where its fallback offers numeric
     ones today;
   - plugin-context rule 4.

   Selva hides geometry inputs. This fixes the text-box bug on its own and makes the host axis
   visible before any new interaction exists.

2. **Pick in Rhino.**
3. **Trigger button.**
4. **Bake to Rhino**, after its design pass.
5. **Upload `.3dm`**, the step that puts geometry inputs on Selva.

Steps 1 to 3 add no layout-item variant, so older plugins read their schemas. They still bump
`schemaVersion` to a new minor (2.16.0): the generators' version guard refuses any change to the
persisted shape without one, and the new enum values and `displayAs` count. An older plugin passes
a newer minor through unchanged and ignores the unknown key. Every bump then needs:

- **Re-key the last migration.** The last `_migrations` entry in `SchemaMigrator` is keyed on
  `SchemaVersion.CURRENT`, so it has to be re-keyed to its literal version first. Otherwise bumping
  `CURRENT` silently turns the old step into the new one.
- **Roll out in order: Selva app, then the Compute server's plugin, then authors' plugins.** Selva
  refuses a schema newer than its own `UI_SCHEMA_VERSION` and never migrates; it re-extracts the
  schema through Compute, where the C# migrator runs. While the app is ahead of Compute, every
  render re-extracts, because the cached schema only counts on an exact version match.

## What still has to be proven

1. **`AutoAssignContextualData` prompts outside a command.** Called from the bridge on the UI
   thread with focus in the panel: Rhino's command line shows the param's prompt, the filter holds,
   Esc cancels, and the panel is usable afterwards. If it needs a command context, the fallback is
   `GH_RhinoScriptInterface.RunInCommandContext`. If that doesn't fit either, Selva runs its own
   `GetObject` with the filter read from the param.
2. **Exempt picks survive and clear when they should.** They survive later solves and a full
   recompute (F5). Clear, a new pick and the end of the session each empty them.
3. **A hidden geometry input on Selva solves with the internalised default.** Find what Compute's
   `/io` reports as a Get Geometry's default, and whether sending it back gives the same result as
   omitting the input.
4. **The tolerant converter round-trips.** A schema with an invented layout-item variant loads in
   the step-0 plugin, renders without that item, and saves it back byte-for-byte.

## Rejected alternatives

- **`source.kind: "rhino"` for a pick.** It names the host inside the schema, so supporting picks on
  Compute later would mean migrating every saved definition.
- **A new `InputGeometryLayoutItem` now.** Older plugins drop the whole schema on meeting it, and
  the schema doesn't need it until upload adds config.
- **A migration rewriting `text` to `geometry` widgets.** Choosing the control from `paramType` gets
  the same result with nothing rewritten. The Rhino-free migrator can't tell Get File Path from Get
  File anyway.
- **A definition-level "local app" or "compute app" mode.** It splits the builder and the element set
  into two products, while most elements work in both hosts.
- **Human UI's model**: UI defined on the canvas, event graphs, any WPF layout. Copy what it's
  useful for (picking, buttons, baking, document data), not how it works. Its UI can't go on the
  web, and Selva's can.
- **Storing which hosts support an element in the schema.** It's derived, so a stored copy drifts.
- **Keeping picks in `ValueApplicator` and re-applying them.** Nothing re-applies today, and that
  store is saved into the `.gh`.
- **A trigger as a value that resets itself.** The page resends its whole value set on every solve,
  and `skipDedup` keys on `paramType`, so exempting a `boolean` button would exempt every checkbox.
- **A Selva-written `GetObject` as the main pick path.** It reimplements the param's own prompt and
  reads a private property. It stays as the fallback.
