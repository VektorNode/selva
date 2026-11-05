# Add to UI from the canvas

Place inputs and outputs into the form without leaving Grasshopper: right-click a Get param, a
Context Bake or a Selva output component (or several), pick a tab and group, done. A Grasshopper
group publishes as a UI group in one click.

The editor already does both, by drag and drop and by the GH-group import dialog
(`GhGroupImportDialog.svelte`, `onImportGhGroups`). This moves the same operations to where the
author is already looking: the canvas.

## What the author sees

### At a glance: the placement tab

Every input and output in the form carries a tab under it with its group name (`Size`), drawn by
Grasshopper's own message renderer: a `GH_Capsule` built on the object's body, then
`RenderEngine.RenderMessage(graphics, text, style)`, from `GH_Canvas.CanvasPostPaintObjects`. It is
the same routine that draws a component's `Message`, so the shape, font and the shoulders that join
it to the object match Grasshopper exactly, on Rhino's and Hops' objects as well as Selva's. Get
params have no `Message` of their own, which is why Selva renders the tab rather than setting one.

- **Placed**: the tab in the neutral `GH_Palette.Normal` style, whatever state the object is in. The
  tab must not take the object's palette: an erroring Get Number turns it dark red, a selected one
  green, and the canvas reads as noise.
- **Not placed**: no tab. The tab's presence is the "assigned" signal, and a canvas full of empty
  markers was harder to read than one without.
- **Hover**: a placed object's tab shows the full path (`General › Size`) when it fits, else keeps
  the group name. An unplaced one shows a light grey `Not in UI` tab.
- **The box is the object's body**, without a Get param's pointed end or a component's zigzag
  edge, and it never grows to fit the text. A wider box puts the tab's shoulders out in the canvas,
  detached from the object.

Hover comes from the canvas's `MouseMove`: `FindAttribute` at the cursor, and a repaint when the
object under it changes.

A canvas toggle (`Show UI placement`, on by default) hides the tabs.

### Where Selva's lines go in the menu

Rhino 8 on a Mac already scrolls a Get param's menu: Enabled, Runtime warnings, Wire Display,
Connect, Reverse to Simplify, then Prompt, At least, At most, Tree Access. Items appended at the end
land below the fold. So Selva's lines go right under Enabled, and there are at most two of them:

- `Add to General › Size` (or `Move to …`), the last-used target, when there is one;
- one line that opens everything else: `Add to UI ›` for an unplaced param, or `UI: General › Size ›`
  for a placed one, whose submenu holds Move to, Show in UI and Remove from UI.

That needs `AppendMenuItems` overridden on Selva's params rather than `AppendAdditionalMenuItems`,
which only appends. A Context Bake or Print menu is short (Enabled, Bake…, Runtime warnings,
Help…), and the menu Selva composes for those puts its lines in the same place.

### Right-click a Get param

An unplaced param:

```
Get Color                        (title)
Enabled
─────────────────────────
Add to General › Size            (the last group used, one click)
Add to UI                ▸   General              ▸   Size
                             Advanced             ▸   Material
                             ─────────────             ─────────────
                             New tab…                  New group…
─────────────────────────
Runtime warnings         ▸       (Grasshopper's own entries continue below)
Wire Display             ▸
…
```

The `Add to <last group>` entry is the fast path for placing a run of params one after another. It
remembers the last target per bridge for the session and is absent until one exists.

A param that is already in the form says where, and the same line opens the rest:

```
UI: General › Size       ▸   Move to              ▸   General   ▸   Size   ✓
                             Show in UI
                             ──────────
                             Remove from UI
```

- **The menu knows where each param sits.** The bridge's schema already maps every layout item's
  `paramId` to its tab and group; the menu reads that at open time. A placed param's Selva line
  names its place, and its current group carries a check mark under Move to.
- **The menu acts on the selection** when the clicked param is part of it, and on the clicked param
  alone otherwise, the way Grasshopper's own Enable/Preview items behave. The header reads
  `Add 3 to UI`, so the scope is never a surprise.
- **Move, never duplicate.** A param shows once in the form. With a mixed selection the leaf reads
  `Size (add 2, move 1)`, and the `Add 3 to UI` line carries a `1 already in` hint. Picking the group a param is already in is a no-op for that param.
- **Moving to a new group or tab** uses the same New group… / New tab… entries. A group a move
  leaves empty stays, as it does when a widget is deleted in the editor: dropping it silently is how
  a tab gets lost.
- **Order follows the canvas**: top-to-bottom, then left-to-right by pivot, appended after the
  group's existing items. That is the order the author laid the params out in.
- **New tab… / New group…** open a one-line name prompt and create the container with the items in
  it. The prompt pre-fills the enclosing GH group's nickname when every selected param shares one.
- **Remove from UI** drops the layout items and keeps the inputs in `schema.inputs`: the same as
  deleting the widget in the editor.
- **Show in UI** opens the panel, switches to the item's tab and flashes the item.
- **One Ctrl+Z undoes the whole action**, on the canvas, as one "Add to UI" undo record.
- After the change the tabs update, the Rhino command line prints
  `Selva: added Width, Height, Depth to General › Size`, and an open editor shows the same as a toast
  with the items highlighted. The command line covers the editor-closed case.

### From the editor: the canvas selection tray

The panel usually sits beside the canvas, and the editor is where tabs and groups are visible. So
the editor shows what is selected on the canvas as a tray above the parameter list:
`3 selected on canvas: Width, Height, Depth`, with an `Add here` button on every group header while
the tray has items, and the tray itself draggable onto a group. This path does not depend on any
canvas hook, works for every param type, and applies to the draft like any editor edit, so it needs
no replay.

Grasshopper 1 raises no selection-changed event. Selection changes repaint the canvas, so the bridge
diffs `SelectedObjects()` in `CanvasPaintEnd` and sends a `canvasSelection` message only when the
set of publishable ids changes.

Right-click a Grasshopper group whose members include inputs or outputs:

```
Publish to UI            ▸   General     (new group "Size", 3 inputs, 1 output)
                             Advanced
                             New tab "Size"
```

It creates a UI group labelled with the GH group's nickname, holding every input and output that
belongs to the group, in canvas order. If the tab already has a group of that name (case-insensitive,
as the import dialog matches), the members are added to it instead of creating a duplicate. Members
already placed elsewhere are moved. Nested GH groups: the innermost group wins, as in
`BuildGroupLookup`. When the GH group is already published, the entry reads `Update "Size" in UI`
and adds only the members not yet in it.

The item is greyed out with a tooltip when there is nothing to act on: no UI Bridge in the document,
or the document has not solved yet (`SchemaLayout`'s precondition).

## Outputs

An output's identity is the object the schema keys it on: the **Context Bake** for files, charts and
dynamic value lists, the **Context Print** for text (rule 3 in
[plugin-context.md](../../docs/contributing/plugin-context.md)). The menu always places that object's
GUID, whatever was right-clicked.

- **Right-click a Context Bake or Context Print**: the same menu as a Get param, through the
  interaction hook below.
- **Right-click a Selva producer** (Set Dynamic Value List, Data To File, Block To File, File From
  Path): the menu resolves downstream to the qualifying bake and places that. One bake: the menu
  reads `Add "steadyOptions" to UI`, naming the bake's input, so the author sees what lands in the
  form. Several bakes: one submenu per bake. None: disabled, `Wire into a Context Bake first`.
  Placing the producer's own GUID is the `UnknownType('Text')` mistake, and nothing repairs it later.
- **The schema bake is never offered**: the bake whose input is nicknamed `Schema`.
- **A bake reached through Merge or Dispatch** qualifies only once a solve has put the goo on it, so
  before that it is disabled with `Solve once first`.
- **Dynamic value list outputs carry their target.** The new `OutputDynamicValueListLayoutItem` gets
  `config.targetInputId` from the Set component's `TargetInputId`. The placement goes through
  `ApplyParameterAccessFromSchema` (design step 4), which is the only path that writes the target
  back to the component, so a canvas-placed DVL output survives the next solve. If the Set has no
  target yet, the item is still placed and the editor shows its existing missing-target state.
- **Inputs and outputs mix freely** in one selection and one group, as they do in the editor.

Publishing a GH group takes outputs too. Membership comes from `ResolveGroupName`, which today
looks only at the identity object. Authors usually group a Set Dynamic Value List with its Get and
leave the bake off to the side, so an output whose bake is in no group falls back to the group of
the producer feeding it. That change lives in `SchemaSynchronizer`, the one place `groupName` is
computed, so the editor's import dialog picks up the same rule and the two never disagree.

## Design

### One operation, applied on the plugin side

All entry points build one request, `{ placements: [{ paramId, tabId, groupId }], newTab?, newGroup? }`,
and hand it to a single service next to `SchemaLayout` (call it `LayoutPlacement`) that:

1. syncs a copy of the schema exactly as `SchemaLayout.Synced` does, so a param dropped seconds ago
   is in `schema.inputs` before it is placed;
2. removes each param's existing layout item, inserts the new one, creating the tab or group if asked;
3. builds new items through `LayoutSpec`'s item factory (`DefaultWidget` + `CanvasConfig`), so a
   value list gets its options and a number its range, the same as a scripted layout. That factory
   is inside the private `Builder` today, so it moves out to a function both can call;
4. commits the schema the way an editor save does.

It works with the editor closed: the schema lives on the bridge and saves with the `.gh`.

Step 4 cannot reuse `ApplyAuthoredSchema` as it stands. It records the undo event, drops tombstones
and sets `Schema`, but it never broadcasts `schemaUpdated` and never calls `document.Modified()`.
The save handler in `BridgeOrchestrator` does both, plus `ApplyParameterAccessFromSchema`,
`SuppressSolvingCycles(1)` and a scheduled expire. So an open editor misses a scripted layout today,
and its next save is rejected against a hash it never saw. The fix is one "commit an authored
schema" method on the bridge that the save handler, `SchemaLayout.Apply` and `LayoutPlacement` all
call, which also fixes the scripted-layout path.

### The editor must not lose a dirty draft

This is the part that decides whether the feature feels solid. Today a `schemaUpdated` that
arrives while the editor is dirty replaces `canonical`, keeps the draft, and warns
(`replaceCanonical`). The author's next save is then rejected by `SchemaSaveGuard`: the canvas
action costs them their pending edits, or a conflict they have to resolve.

So the broadcast carries the operation too: a new wire message `layoutPlaced` with the placement
request, the hash it applied on (`baseSchemaHash`) and the resulting hash. A dirty editor whose
`canonicalHash` equals `baseSchemaHash` replays the same placement on its draft through
`handleItemDrop`, as one history step, and adopts the new hash as its save base. Its draft is then
exactly "new canonical + my edits", so the next save goes through. If the hashes differ, it falls
back to today's warning.

Replay has to be idempotent (a param already in the target group is a no-op, which
`handleItemDrop` already returns as `duplicate`). The message goes in `wire-schema.json`, then
`pnpm generate`.

`canonicalHash` is the wrong thing to compare against. `handleMetadataUpdated` patches canonical
in place after a rename in Grasshopper and sets `canonicalHash = null`, so any rename since the last
broadcast would make every replay fall back. The editor needs a separate `draftBaseHash`: the hash
of the canonical its draft was cloned from or last rebased onto, which a metadata patch does not
touch because the plugin's own copy changes the same way.

A clean editor needs nothing new: `schemaUpdated` already replaces its draft.

### Where the menu items come from

`SelvaContextualParameter.AppendAdditionalMenuItems` is ours, so Selva's Get params (color, file,
image, value list, dynamic value list, server file) get the menu with no risk, and so do Selva's
output producers through their own `AppendAdditionalMenuItems`.

Rhino's own Get Number, Get String, Get Geometry, Hops' Context Bake and Context Print, and
`GH_Group` are not Selva's types: Selva cannot override their menus. Those are most of the inputs
and every output identity in a real definition, so the feature is only half there without them.
There is no public hook for this. `GH_Canvas.AddValidator` exists and `IGH_CanvasValidator` has a
`CanShowObjectMenu`, but Grasshopper never calls it: an IL scan of Rhino 8's `Grasshopper.dll` finds
no caller anywhere. The object menu is built inside `GH_Canvas.Canvas_MouseUp`, which runs
`MouseUp_Interaction` first, then `FindAttribute` → `IsMenuRegion` → the object's
`AppendMenuItems` → `ToolStripDropDown.Show`.

What works, tested live on Rhino 8 for Mac against Rhino's Get Number, Hops' Context Print and
Selva's Get Color: Selva subscribes to the canvas's `MouseDown`. On a right button over a
publishable object it replaces `canvas.ActiveInteraction`, which Grasshopper has just set to a
`GH_PanInteraction`, with its own interaction. `Canvas_MouseUp` hands the release to that
interaction and never reaches its own menu code, so exactly one menu opens: the object's own
`AppendMenuItems`, with Selva's lines inserted after `Enabled`, and clicks on them arrive. If the
mouse moves more than a few pixels first, the interaction hands over to a new `GH_PanInteraction`,
so right-drag still pans.

Two details from the test:

- `FindAttribute` does not return groups. A group is hit by testing `GH_Group.Attributes.Bounds`,
  smallest first so a nested group wins.
- Menus differ by object: a Get Number's starts with Prompt, then Enabled; a Context Print's with
  Enabled, Bake…. Inserting after the `Enabled` item puts Selva's lines in the same place on each.

Still untested: Windows, Rhino 9, and another plugin that also replaces the interaction on
right-click. The other entry points stay regardless, because they cost little and cover those
cases:

- Selva's own params and producers, through `AppendMenuItems`;
- **the canvas selection tray in the editor** (above);
- a **UI Bridge menu item, `Add selection to UI ▸`**, acting on the canvas selection, plus
  `Publish group to UI ▸` when the selection is exactly one GH group.

### Which bridge

One UI Bridge in the document: target it, no question asked. More than one: the first submenu level
is the bridge's nickname. Zero: the item is disabled with "Add a UI Bridge first".

The tab and group list comes from the bridge's saved schema, not from an open editor's draft. A
group the author created in the editor and has not saved yet does not show on the canvas; the
New group… entry covers that case.

## Decisions

- **Plugin-side apply, not "send a command to the editor".** Routing the action to the open editor
  would let the editor's own factory build the item, but the feature would then do nothing with the
  editor closed, and with two editors open it is unclear which one owns it. The replay message gets
  the same draft safety without that dependency.
- **Move, not duplicate.** A param in two groups is two widgets fighting over one value. The canvas
  menu never creates a second item.
- **Publishing a GH group is one-shot, not a live link.** Keeping UI membership in sync with GH group
  membership would make two places the source of truth for the layout: a param dragged out of a
  group in the editor would spring back on the next canvas edit. Re-publishing after changing the GH
  group adds the new members, which covers the "keep it in sync" need without a link.
- **No new schema field.** Nothing about canvas origin is stored in `ui-schema.json`; the result is
  an ordinary layout. No `schemaVersion` bump, no migration.

## Risks worth testing

- **Two item factories, already drifted.** `LayoutSpec.DefaultWidget` (C#) and
  `mapParamTypeToWidgetType` (TypeScript) both pick a widget from a type, and today they disagree
  twice. C# returns no widget for `geometry`, `point`, `line` and `plane`, so a layout spec refuses
  those params unless it names a widget; the editor uses the `text` placeholder that
  plugin-context.md describes. C# shows an `integer` output as `text`; the editor shows it as
  `number`. C# moves to the editor's mapping, and a parity test over every `ParamType` and output
  type (fixture in `packages/schemas`, read by the C# and the vitest suites) keeps them together.
  Replay depends on it too.
- **Producer → bake resolution.** A Set feeding two bakes, a bake behind a Merge, and the schema
  bake each need a test; getting this wrong writes an output id nothing repairs.
- **Undo across the two sides.** Ctrl+Z on the canvas restores the bridge's archived state, and
  nothing shows that restoring it broadcasts the schema. If it does not, an open editor keeps
  showing the placement Ctrl+Z just took back. Check it; if it is silent, the bridge broadcasts
  when a read-back changes the schema hash.
- **Player sessions.** A player page (`role: player`) ignores `layoutPlaced`; it already re-renders
  from `schemaUpdated`.
- **Panel freeze.** The WebView shares the UI thread with the solver. The placement does not solve,
  so the panel updates at once; confirm it does not trigger an expire that does.

## Suggested issue split

Each can be picked up alone, in this order:

1. One "commit an authored schema" method shared by the save handler and `SchemaLayout.Apply`, and
   C#'s widget mapping brought in line with the editor's, with the parity test. Both fix bugs that
   exist today.
2. `LayoutPlacement` service + tests (Rhino-free, beside `LayoutSpec`).
3. `layoutPlaced` wire message, `draftBaseHash`, editor replay on a dirty draft, toast and highlight.
4. Canvas menus on Selva's own params, the Bridge's `Add selection to UI`, multi-select.
5. Placement tabs and hover.
6. Canvas selection tray in the editor.
7. Outputs: producer → bake resolution, DVL target, the menus on producers.
8. Publish GH group to UI, with the producer fallback in `ResolveGroupName`.
9. The interaction hook for Rhino's and Hops' objects, then its check on Windows and Rhino 9.
