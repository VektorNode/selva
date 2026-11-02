---
'@selvajs/visualization': minor
---

Built-in wood, concrete, plaster, brick and corten surfaces, drawn at real size with no texture files. Sun shadows are softer and lighter. Lights now survive a solve: `clearScene` was removing them, which left only the environment map after the first solve. The sun stays outside building-sized scenes, so everything casts a shadow. Night's fill light no longer blows out large models, and a glow spread across a facade no longer burns a hot spot into it.
