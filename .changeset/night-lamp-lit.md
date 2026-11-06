---
'@selvajs/visualization': minor
---

The `night` look is now lit by the model's lamps instead of by fill. Before, a white surface away from any lamp still read at half brightness, and polished metal mirrored a lit studio, so a chrome lamp looked like a daytime product shot. Now:

- the fill is cut so the lamp lights the scene
- metal reflects about as much as white paint does in the same dark
- lamp light is scaled up 3×, so a lamp lights its desk without lifting the background

A glow sent without lumens now lights like the lamp its strength stands for (strength × 160 lm), the same as one sent with lumens. It used to be scaled to the scene's size, so the same glow lit a large scene far more than a small one.

`LookPreset` gains `metalReflection` (how much a fully metallic material reflects, default 1) and `emissiveLightScale` (a multiplier on the light glowing parts cast, default 1).
