---
'@selvajs/visualization': minor
---

`@selvajs/visualization` no longer depends on `@selvajs/compute`.

Mesh conversion and the viewer now work for a consumer who has neither Selva nor Rhino.Compute:
`shared/`, `parse/`, `render/` and `scene/` need only `three`, `rhino3dm` and `fflate`. Four things
moved in-package:

- **`VisualizationError` replaces `RhinoComputeError`** in the parse layer. The old name described a
  transport the failure had nothing to do with — on the plugin's WebSocket path a corrupt mesh blob
  never went near Rhino.Compute. **The `code` values are unchanged** (`VALIDATION_ERROR`,
  `INVALID_STATE`, `ENVIRONMENT_ERROR`), so catch-sites matching on `error.code` keep working; only
  code matching on `instanceof RhinoComputeError` or `error.name` needs updating.
- **A local logger** (`getLogger`/`setLogger`/`enableDebugLogging` from
  `@selvajs/visualization/shared`). It defaults to no-op, exactly as compute's does, so output is
  unchanged. For one sink across both packages:

  ```ts
  import { setLogger } from '@selvajs/visualization/shared';
  import { getLogger } from '@selvajs/compute';

  setLogger(getLogger());
  ```

- **A local `decodeBase64ToBinary`**, copied from compute rather than imported.
- **The Grasshopper response envelope is now declared structurally** as `DisplayComputeResponse`
  (exported from `@selvajs/visualization/parse`) — only the fields the parser actually reads.
  `getThreeMeshesFromComputeResponse` is otherwise unchanged and compute's
  `GrasshopperComputeResponse` stays assignable to it, so existing calls need no edit.

**Not changed:** `session/` still depends on `@selvajs/schemas`, because projecting a Selva UI schema
into solve inputs is what it does. Importing `@selvajs/visualization/session` or the root barrel
still pulls that in; the four sub-paths above do not. Moving it out is tracked in
`docs/plans/solve-package.md`.
