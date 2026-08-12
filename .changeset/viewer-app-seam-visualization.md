---
'@selvajs/visualization': minor
---

Viewer app seam: host apps can now own scene content and pointer input.

- `initThree` returns a `tools` registry. Register a `PointerTool` and it competes for canvas
  clicks ahead of object selection, ordered by priority; `setActive` enforces one active tool.
  Measure and the view gizmo are pre-registered as `'measure'` and `'gizmo'`.
- `addUserGeometry(object, appId?)` takes an owner id, tagging `userData.source = 'app:<id>'`, and
  `clearUserGeometry(appId?)` clears one app's geometry instead of everything. Untagged `'user'`
  geometry keeps working as before. `clearScene` spares both, so host content survives a solve.
- `labelLayer` is on `ThreeViewer` and always built. It was previously created only when
  `measure.enabled`, leaving other annotation consumers with no way to reach one.
- `pickThreshold` and `snapToVertex` are public, so a host tool's grab band and vertex snapping
  match the built-in tools instead of drifting from them.

No new tools ship here — apps bring their own. See `src/render/VIEWER-APPS.md`.
