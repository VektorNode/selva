---
'@selvajs/mcp': minor
'@selvajs/selva': minor
---

The MCP solve view lights and reads like Selva's own viewer, and `selva_solve` reads the outputs it used to report as a type count:

- The 3D view opens in the definition's look and background (`SolveViewData.look`, `background`). After each solve it fits the sun's shadows to the new geometry and lights glowing parts, so `night` shows a model's lamps. A look picker in the header switches look, and "Hide inputs" leaves only the model.
- `mountSolveViewer` takes `{ look, background }`; `SolveViewer` gains `setLook` and `redraw`; `toLook` and `LOOKS` are exported from `@selvajs/mcp/view`.
- A Dynamic Value List output is listed as the options it computed, under the label of the input they fill, and an Options Table as its valid combinations. The view's form offers those options instead of the author's defaults.
- A Plotly chart output is listed as its title and each trace's labels and values.
- `selva_capture_preview` no longer fails in a production build with `read_asset_missing` for the viewer's environment map.
- `selva_describe_definition` says a dynamic list's options come from the solve, and gives its defaults.
