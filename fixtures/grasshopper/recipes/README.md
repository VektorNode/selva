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

## Rebuild a fixture

1. `g1_start` — open Grasshopper.
2. `g1_apply_graph` with the recipe's `apply` object.
3. Compare the result against `expect`. `apply_graph` never aborts: a component your build
   didn't register comes back in `PlaceErrors` rather than silently yielding a half-built canvas.
4. `g1_get_canvas_graph` to read back wires and per-param data.
5. Save — there is no GH-document save tool (`save_doc` is the Rhino document), so use
   `run_csharp`:

   ```csharp
   var doc = Grasshopper.Instances.ActiveCanvas.Document;
   doc.SaveAs(@"d:\Coding\selva\fixtures\grasshopper\ui_bridge_minimal.ghx");
   ```

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
