---
title: Display
group: Plugin
order: 3
published: true
description: 'Get Grasshopper geometry into the browser 3D viewer, and control how it looks.'
---

# Display

Five components. You will use **Display** every time; the other four are supporting cast.

For what happens to the payload once these components produce it, see [the display pipeline](../plugin/display-pipeline.md).

## Display

Turns geometry into the payload the web viewer renders. Drop it, feed it geometry, and the UI Bridge picks it up on its own — unlike file outputs, it needs no ContextBake.

| Input                   | Access | Purpose                                                                                       |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `Geo` (G)               | tree   | The geometry. Anything that isn't a mesh gets meshed; curves and points ride along untouched. |
| `Name` (N)              | tree   | Per-object name, shown in the scene outliner.                                                 |
| `Layer` (L)             | tree   | Grouping path, e.g. `Structure/Walls`. This is what builds the outliner's tree.               |
| `Metadata` (D)          | tree   | `Key=Value` strings, shown when the user selects the object.                                  |
| `Material` (M)          | tree   | A **Three Material**. Objects sharing one are batched into a single draw call.                |
| `Meshing Settings` (MS) | item   | Rhino meshing parameters. Defaults to `FastRenderMesh`.                                       |

Only `Geo` and `Name` are required.

**One batch per input branch.** The output tree mirrors the input tree instead of flattening, so the structure you built upstream survives into the viewer.

Two habits that pay off:

- **Set `Layer`.** Without it, the scene outliner is a flat list of every object. With it, you get a navigable tree for nothing.
- **Share materials.** Every distinct material costs a separate draw call. Ten objects sharing one material render far faster than ten objects with ten near-identical materials.

## Three Material

Builds the material for Display's `Material` input.

| Input             | Default | Notes                                                                                     |
| ----------------- | ------- | ----------------------------------------------------------------------------------------- |
| `Color` (C)       | white   |                                                                                           |
| `Metalness` (M)   | 0.0     | 0–1.                                                                                      |
| `Roughness` (R)   | 0.5     | 0–1.                                                                                      |
| `Opacity` (O)     | 1.0     | 0–1. Needs `Transparent` for anything below 1 to show.                                    |
| `Transparent` (T) | false   |                                                                                           |
| `Texture` (TX)    | —       | A bitmap, an image URL, or a path. Textured meshes carry their UVs through to the viewer. |

## Display To File / Display From File

A cache pair for expensive meshing. **Display To File** writes a payload to a `.dmf` on disk when its `Write` input goes true; **Display From File** reads one back by path.

Reach for them when your geometry is slow to mesh and doesn't change every solve. Mesh once, then load the `.dmf` on later runs instead of re-meshing.

## Display Size

Diagnostics for a payload: total bytes, a human-readable size, and vertex and triangle counts.

Check this first when a scene loads slowly. A large byte count usually means you are meshing too finely, or shipping geometry the user will never look at.

## Next

- [The display pipeline](../plugin/display-pipeline.md): what happens to the payload next.
- [File I/O](../plugin/file-io.md): downloadable outputs.
- [Plugin overview](../plugin/overview.md)
