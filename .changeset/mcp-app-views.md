---
'@selvajs/mcp': minor
---

Serve MCP App views. A tool names the view its results show in with `ui: { resourceUri, visibility? }`
(sent as `_meta.ui`), `appResource()` serves that view as `text/html;profile=mcp-app` with its CSP,
and a tool's `meta` becomes the result's `_meta`: data for the view, kept out of the model's context.
`visibility: ['app']` makes a tool only its view can call. A tool naming a view no `appResource`
serves is refused at startup.

`@selvajs/mcp/view` is the browser side: `connectView` connects a view to its host and follows
its theme, and `mountSolveViewer` draws a Rhino.Compute response in 3D. `solveView()` serves a
ready-made 3D view (`SOLVE_VIEW_URI`) that draws what a tool hands it under `SOLVE_VIEW_KEY`,
inline or through an `['app']` tool it calls.
