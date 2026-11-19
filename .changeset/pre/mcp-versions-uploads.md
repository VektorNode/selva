---
'@selvajs/selva': minor
'@selvajs/server': minor
'@selvajs/schemas': minor
---

More MCP tools, and what they needed underneath:

- `selva_check_upload`, `selva_upload_version` and `selva_create_definition` take a `.gh` or `.ghx` as base64. `selva_solve`, `selva_describe_definition` and `selva_capture_preview` take `version: 'draft'` or a version id, to try an upload before publishing it.
- `selva_list_versions` and `selva_compare_versions` show the history and what each version changed, in the form and inside the file. Rolling back is `selva_publish_definition` with an older id.
- `selva_describe_definition` lays the form out by group, with each group's description, number units, the conditions that show or hide an input, and output descriptions.
- The 3D view in MCP Apps clients draws the definition's inputs beside the geometry, to change and solve again.
- `selva_capture_preview` renders with the look and background the definition opens in, lit by the app's HDR.
- File links, geometry and previews are kept in the storage provider, so they survive a restart and work across instances.
- An upload whose file uses a component the Compute server's plugin release lacks is refused like one with a missing plugin, unless `acceptMissingPlugins`; the version summary lists such components as `unloadedComponents`.
- `GET /api/v1/projects/{id}/members` returns each member's `displayName`. Uploads are marked `x-long-running`, so MCP clients give them the solve timeout.
