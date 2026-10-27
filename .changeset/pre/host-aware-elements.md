---
'@selvajs/schemas': minor
'@selvajs/ui': minor
---

Schema 2.16.0: `ParamType` gains `geometry`, `point`, `line` and `plane` for Rhino's Get Geometry, Get Point, Get Line and Get Plane, and `CheckboxWidgetConfig` an optional `displayAs: 'button'`. The UI picks a geometry input's control from its `paramType` and renders geometry inputs and buttons only where they work: in Rhino, picking in the viewport and pressing a button. Selva leaves them out for now, and the definition solves with its own values there. Presets skip both. Only the Rhino panel picks; a browser tab shows what the panel picked. While a pick runs, the input says to pick in the viewport, Esc to cancel.
