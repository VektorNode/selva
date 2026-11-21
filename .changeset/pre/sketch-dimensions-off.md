---
'@selvajs/sketch': minor
'@selvajs/ui': minor
---

Curve inputs no longer label every segment with its length by default; the dimensions checkbox on a curve input turns them on. The viewer draws only the curve inputs the form shows: one that is hidden, unplaced, or switched off by a visibility rule no longer puts its curves in the scene. A curve input with curves has a "Show in viewer" checkbox that hides them while nothing is being drawn; drawing or moving points shows them again. `SketchSettings` gains `hidden`, and `SketchController` gains `setHidden(paramId, hidden)` and `view(paramId).hidden`.
