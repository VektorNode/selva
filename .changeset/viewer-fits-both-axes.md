---
'@selvajs/visualization': patch
'@selvajs/ui': patch
---

The viewer frames a model to fill the view: opening, fit-to-view, presets and `frameBounds` fit every corner across both the width and the height of the canvas with a 10% margin, instead of the largest side against the height with 50% to 300% slack. A fit is redone when the canvas changes shape until the user moves the camera, so a viewer in an opening dialog no longer keeps the framing of its first size.
