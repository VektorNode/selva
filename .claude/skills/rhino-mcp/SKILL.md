---
name: rhino-mcp
description: Drive a live Rhino 8 / Grasshopper from the session via the Rhino MCP tools — build or regenerate a .ghx fixture, place and wire components, read live param data, and debug Selva.gha plugin behaviour. Use whenever the task involves building/rebuilding a Grasshopper fixture, inspecting what a component actually outputs at solve time, reproducing a plugin bug in Rhino, or any mcp__rhino__* tool.
---

# Rhino MCP

Verified against Rhino 8.33, Grasshopper 1.0.0008, Rhino MCP Platform 0.1.5 (2026-07-31).

## Check first

Tools are `mcp__rhino__*`. If absent, they cannot be added mid-session: MCP servers are fixed at
session start. Tell the user to run `MCPConnect` in Rhino and start a new session — don't try to
work around it.

If the plugin itself isn't loading (`MCPStart`/`MCPConnect` don't exist as Rhino commands): Rhino 8
blocks unsigned .NET plugins and `RhinoMcpPlatform.rhp` isn't Authenticode-signed. The block must
be lifted in Rhino; a clean `yak install` hits the same wall.

## Install (once)

[Rhino MCP Platform](https://github.com/mcneel/RhinoMCP) (McNeel, MIT). Rhino 8 packages are
per-user and `yak install` only resolves names from a package server, so a local `.yak` is
extracted by hand:

```powershell
# from a plugin-vX.Y.Z release, asset *-rh8_29-win.yak
Expand-Archive rhino-mcp-platform-0.1.5-rh8_29-win.yak -DestinationPath `
  "$env:APPDATA\McNeel\Rhinoceros\packages\8.0\Rhino-MCP-Platform\0.1.5"
```

Restart Rhino. It loads as `RhinoMcpPlatform.rhp`, independent of `Selva.gha` in `Libraries-8/`,
and its transport is a router process over a filesystem slot directory — no contention with
Selva's WebSocket on 8765.

The plugin is pre-1.0 (`0.1.5` stable, `0.2.1-wip` at tip); tool names are not yet stable.

## Two tools are broken — don't use them

`g1_apply_graph` and `g1_connect` error and change nothing, even for one stock component with zero
wires. They fail before touching the document, so a failed call leaves the canvas clean.

**Build graphs with `run_csharp` instead.** Ready-to-paste C# for every case below —
place-and-wire, save, graft a schema, enumerate components, reset, API discovery — is in
[`reference.csx`](reference.csx) next to this file. Read it when you need the code; the traps that
decide whether the code works are here.

Working tools: `g1_start`, `g1_place_component` (resolves third-party Guids fine),
`g1_describe_component`, `g1_search_components`, `g1_get_canvas_graph`, `g1_clear_canvas`
(needs `confirm=true`), `run_csharp`.

## Method

**Verify against `g1_get_canvas_graph`, never against a tool's return value.** It returns per-object
`Messages` (balloon warnings/errors) and per-param `DataSummary {Branches, Items, Sample[]}` — that
is ground truth and what makes a debugging walk assertable instead of eyeballed. Read back _after_
a solve; placement runs on Grasshopper's UI thread and an immediate read can miss it.

`run_csharp` has no implicit `using System` — fully qualify or declare usings. Its
`System.Windows.Forms` CS1701 warning is harmless. When a call won't compile, reflect over the type
rather than guessing at method names ("Discover an API" in `reference.csx`).

## Selva components

All visible — 61 proxies across Display, Drawing, Elements, IO, UI, Utilities, with full param
metadata. Two caveats from the OBSOLETE + upgrader procedure:

- **17 are obsolete and share their live component's name** (`Display` has 6 under one name,
  `Create File` and `Geometry To File` 3 each, `UI Bridge` 2). `g1_describe_component` and
  `g1_search_components` match by name, so both can hand back a retired variant. **Pin by Guid.**
- **Searching `"Selva"` does not list Selva components** — `g1_search_components` matches
  Description too, so it returns whatever mentions "the Selva UI" in prose. Filter
  `ObjectProxies` by `Desc.Category` in C# instead.

Component traps:

- **UI Bridge self-scaffolds.** Placing `593bc967-…` alone creates a pre-wired Boolean Toggle and
  Context Bake — 3 objects, 2 wires, from one placement. Also placing those two yields 5 objects
  and duplicate wires into `Enable`. For a bare placement wrap `AddObject` in
  `GH_UIBuilderComponent.SuppressAutoWire()` (public since 0.16.1; the flag is `[ThreadStatic]`).
- **Toggling `Enable` starts the WebSocket server** on 8765 and opens the web UI. Set it back to
  `false` and re-solve when done, or the server outlives the graph.
- **Context Bake's input is named `Content`, nicknamed `Schema`.** Wire it by index `0`.

## Fixtures

`GH_Document.SaveAs` does not exist in this build and `save_doc` is the _Rhino_ document. Use
`GH_Archive`: set `doc.FilePath` first (or `Name` writes empty), `AppendObject(doc, "Definition")`,
then add a `CreateTopLevelNode("Thumbnail")` chunk — Grasshopper's own save writes two root chunks,
and omitting the thumbnail leaves one.

**A rebuild silently drops authored state unless you put it back.** Fresh InstanceGuids and
timestamps are expected. What is not: a freshly-placed component has no persisted data. A rebuilt
UI Bridge reads **"Offline • No Schema"** and its `Container` chunk is missing the `Schema` item —
the graph is right, the content is empty. Nicknames go too (`UI Bridge` reverts to `UIBridge`).

**Before overwriting any committed fixture, diff for dropped items:**

```bash
git show HEAD:path/to/fixture.ghx > /tmp/old.ghx
diff <(grep -oE '<item name="[^"]+"' /tmp/old.ghx | sort -u) \
     <(grep -oE '<item name="[^"]+"' path/to/fixture.ghx | sort -u)
```

A missing `<item name="Schema"` means the fixture is degraded. Don't commit it — graft the schema
back (next section), or restore from git.

`fixture_dynamic_value_list.ghx` additionally needs 8 C# Script bodies and a locked group, which
have no equivalent graft path — hand-edit that one.

## Authoring the embedded UI schema

`GH_UIBuilderComponent.Schema` is a public property (Selva >= 0.16.1) over the `_embeddedSchema`
field that `Read()` populates; the setter expires the solution for you. Assigning it persists
through `Write()` and survives a reload — including correct polymorphic layout-item types. On
older builds, write the private `_embeddedSchema` field instead; both persist identically.

You still reach the property by reflection from `run_csharp` — the script sandbox can't reference
`Selva.Schema`, so `UISchema` isn't nameable there even though the property is public.

This makes fixtures with **arbitrary UI schemas** buildable: typed inputs with defaults, outputs,
tabs, groups, widget config. Verified round-tripping `InputNumberLayoutItem` + `InputTextLayoutItem`
through save→reload. Snippet: "Graft an embedded UI schema" in `reference.csx`.

**Validate before grafting — do not hand-check the shape.**

```bash
node .claude/skills/rhino-mcp/validate-ui-schema.mjs <file.json>
```

[`packages/schemas/ui-schema.json`](../../../packages/schemas/ui-schema.json) is a real draft-07
JSON Schema rooted at `UISchema`, authoritative for both stacks. Every trap below is caught by it
and by nothing else at authoring time — Newtonsoft ignores unknown keys and binds enums
case-insensitively, so a wrong payload deserializes without complaint and quietly loses content:

- **Nesting is `layout.tabs[] → groups[] → items[]`.** A tab has no `items` — putting them there
  yields `items=0` with no error.
- **Layout items key on `paramId`, not `inputId`,** and the discriminator is two fields:
  `type: "input"` **plus** `widgetType: "number"` — not a single `type: "input-number"`.
- **`paramType` is lowercase**: `number`, `integer`, `boolean`, `text`, `valueList`,
  `dynamicValueList`, `file`, `color`, `generic`. `"Number"` binds fine and is still wrong.

Required: `TabConfig` needs `id`/`label`/`groups`, `GroupConfig` needs `id`/`label`/`items`,
`LayoutItemBase` needs `id`/`paramId`, `SchemaInput` needs `id`/`nickname`/`paramType`.

For semantic checks beyond shape — orphaned params, missing widget config, version drift — the
plugin's own `Selva.Schema.Services.Validation.SchemaValidator` runs six rule classes over a live
`UISchema` and is reachable from `run_csharp`. Use the JSON Schema on a payload before it goes in;
use `SchemaValidator` on a schema already grafted onto a component.

Set `documentId` to the live `doc.DocumentID`, not the value copied from another fixture.

Verify by reloading, never by assuming the save worked:

```csharp
back.ExtractObject(fresh, "Definition");   // then walk tabs → groups → items
```

The `[Selva Warning] Could not write schema history: Method not found: JToken.ToString` on save is
a Newtonsoft mismatch in the MCP script sandbox. It affects only the optional history backup — the
`Schema` item itself is written correctly. Confirm with the diff above rather than trusting it.
