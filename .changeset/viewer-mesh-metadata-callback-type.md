---
'@selvajs/ui': patch
---

Fix a type error in `Viewer.svelte`: its `onMeshMetadataClicked` handler declared its parameter as
`Record<string, string>`, but the callback receives a Three.js object's `userData`, typed
`Record<string, unknown>`. Callback parameters are checked contravariantly, so the narrower
annotation failed to assign and `svelte-check` errored on the package.

The handler now takes `Record<string, unknown>` and coerces the object name with `String(… ?? '')`
before falling back to the localized placeholder. Nothing downstream changes shape —
`hasUsefulMetadata`, `selectedMeshMetadata` and `MeshMetadataDialog` all already accept
`Record<string, any>`.
