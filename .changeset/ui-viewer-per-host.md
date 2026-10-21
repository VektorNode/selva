---
'@selvajs/ui': minor
---

`AppLayout` takes a required `showViewer` prop instead of reading the schema's viewer flags itself, so each host decides from its own switch. `ComputeApp` shows the 3D viewer only when `viewerOptions.enableRemote` is set; `enableLocal`, which belongs to the plugin's local preview, no longer turns it on.
