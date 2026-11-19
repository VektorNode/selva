---
'@selvajs/selva': minor
'@selvajs/server': minor
'@selvajs/schemas': minor
---

The MCP server can do what an agent setting up a definition needs, without falling back to the REST API:

- `selva_check_definition` lists the plugins a definition was saved with beside the versions its Compute server loaded, and names what will break: a missing plugin, a component the installed release lacks, obsolete components. `selva_recheck_definition` reads it again after an install. A solve that reports errors points at it.
- `selva_update_definition` edits the name, description, category and tags, and moves a definition to another project, by id or name.
- `selva_capture_preview` solves and renders the result in Selva's viewer, headless on the server, and returns the picture. `selva_set_cover_image` makes a preview (or a given image) the cover and shows the stored result; `selva_get_cover_image` shows the current one. Rendering needs a Chromium: `npx playwright install --with-deps chromium`, or `MCP_PREVIEW_BROWSER`.
- `selva_list_project_members` and `selva_create_project`.
- `selva_solve` returns a download link per output file instead of only its name, and clients that show MCP Apps draw the geometry in a 3D view.
- Listing and describing a definition say whether it can be solved (it has a live version) apart from whether the library lists it, instead of a `draft` status that read as "can't run".

`GET /api/v1/definitions/{guid}/image` returns the cover to an API key; `coverImage` is a browser URL that needs a session. A version's inventory records components the Compute server could not load, and its report gains `plugins` and `extractedWith`.
