---
'@selvajs/ui': minor
---

Add an optional branding logo watermark to the 3D viewer. `Viewer` and `AppLayout` gain a `logoUrl` prop, and `ComputeApp` gains a `logo` prop; when set, the logo renders as a small, non-interactive watermark in the viewer's bottom-right corner (omitted/empty renders nothing). Note: `ComputeApp`'s `logo` now drives this viewer watermark rather than the app header.
