---
'@selvajs/schemas': minor
'@selvajs/visualization': minor
'@selvajs/ui': minor
---

Schema 2.19.0: an optional `viewerOptions.look` sets the look a definition opens in. A new `night` look lights the scene from what the model emits: a material carrying `emissive` and `emissiveIntensity` gets a shadow-casting point light and bloom. `emissiveLight` sets that light's intensity directly. The plugin's new Emissive Material component makes any material glow, from a colour and strength, or from a real source's Kelvin and Lumens.
