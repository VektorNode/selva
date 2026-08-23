# Fixture recipes

Each `*.json` here rebuilds the sibling `../*.ghx` through the [Rhino MCP Platform](https://github.com/mcneel/RhinoMCP)
(McNeel, MIT). The recipe is the reviewable artifact; the `.ghx` is generated output.

Requires a **running Rhino 8** with the MCP plugin installed — this is a local development aid,
not a CI step.

## Install

Rhino 8 packages are per-user, so the `.yak` extracts straight into the packages folder
(`yak install` only resolves names from a package server, not local files):

```powershell
# from a plugin-vX.Y.Z release, asset *-rh8_29-win.yak
Expand-Archive rhino-mcp-platform-0.1.5-rh8_29-win.yak -DestinationPath `
  "$env:APPDATA\McNeel\Rhinoceros\packages\8.0\Rhino-MCP-Platform\0.1.5"
```

Restart Rhino. It loads as `RhinoMcpPlatform.rhp`, independent of `Selva.gha` in `Libraries-8/`.
The MCP transport is a router process using a filesystem slot directory, so it does not contend
with Selva's WebSocket on 8765.

**Rhino 8 blocks unsigned .NET plugins**, and `RhinoMcpPlatform.rhp` is not Authenticode-signed.
Until that block is lifted the plugin never loads, so `MCPStart` / `MCPConnect` don't exist as
commands and every start attempt fails. A clean `yak install` hits the same block — it is not an
install-method problem.

Then run `MCPConnect` in Rhino and paste its prompt into a **new** agent session: MCP servers are
fixed at session start, so the `mcp__rhino__*` tools won't exist in a session that began before
the server was up.

## Rebuild a fixture

> **`g1_apply_graph` and `g1_connect` are broken in 0.1.5** — both error and change nothing, even
> for a single stock component with no wires. Build the graph with `run_csharp` instead, using the
> place-and-wire helper in [`.claude/skills/rhino-mcp/reference.csx`](../../../.claude/skills/rhino-mcp/reference.csx).

1. `g1_start` — open Grasshopper.
2. Place and wire via `run_csharp`. Placing by Guid with `g1_place_component` also works if you
   only need components and no wires.
3. `g1_get_canvas_graph` to read back wires and per-param data — this is ground truth, not the
   tool return values.
4. Save via `run_csharp` and `GH_Archive` (`GH_Document.SaveAs` does not exist in this build, and
   `save_doc` is the _Rhino_ document) — see the save snippet in `reference.csx`.

**Check what the rebuild dropped before overwriting a committed fixture.** A freshly-placed
component carries no authored state, so a structurally correct rebuild can still lose data —
`ui_bridge_minimal.ghx` stores a serialized `Schema` item that only the designer produces. Details
and a diff recipe in the `rhino-mcp` skill (`.claude/skills/rhino-mcp/SKILL.md`).

## Conventions

**Pin components by Guid, not name.** `g1_search_components` matches Name, NickName _and_
Description by substring and returns the first `limit` hits, so a bare name is ambiguous. Use it
to discover a Guid, then hard-code the Guid in the recipe. Selva's own components appear there
like any other once `Selva.gha` is loaded.

**Wire endpoints accept an index or a param name.** Prefer names on Selva components: names
survive a param reorder, indices do not — which is exactly the distinction the OBSOLETE +
upgrader procedure turns on. Use an index only for single-param stock components.

Recipes carry no `InstanceGuid`. A rebuild produces fresh instance ids, so a regenerated `.ghx`
will not be byte-identical to its predecessor — diff the recipe, not the XML.

The plugin is pre-1.0 (`0.1.5` stable, `0.2.1-wip` at tip); tool names are not yet stable.
