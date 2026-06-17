---
title: Plugin overview
group: Plugin
order: 1
published: true
---

# The Selva plugin

`Selva.gha` is the Grasshopper side of Selva: where an author turns a definition into a web interface and where Rhino.Compute runs it at deploy time. A single self-contained `.gha` with all web assets embedded.

Components are organized into five feature areas:

| Feature         | Does                                                                         | Page                                   |
| --------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| **UI Builder**  | Links a definition to a schema and runs the WebSocket bridge to the designer | [UI Builder](../plugin/ui-builder.md)  |
| **Display**     | Configures how geometry renders in the web 3D viewer                         | [Display](../plugin/display.md)        |
| **File I/O**    | Exports geometry, blocks, and data to files served to the web                | [File I/O](../plugin/file-io.md)       |
| **Compute I/O** | Interactive inputs: value lists, colors, files, environment                  | [Compute I/O](../plugin/compute-io.md) |
| **Drawing**     | Document-model 2D drawings rendered to SVG/PDF                               | [Drawing](../plugin/drawing.md)        |

## Install

Download from the Grasshopper Package Manager or [Food4Rhino](https://www.food4rhino.com/en/app/selva).

1. Install **Selva** from the Grasshopper Package Manager (or drop the downloaded `.gha` into your Libraries folder).
2. Restart Rhino.
3. Install the same `.gha` on your Rhino.Compute server so the deployed app can solve.

Install paths per OS are in the repo [README](https://github.com/VektorNode/selva#readme).

## Selva Canopy

[Selva Canopy](https://www.food4rhino.com/en/app/selva-canopy) is a companion plugin that adds plotting components for Selva. Install it from Food4Rhino alongside the main plugin.

## Next

- [Get Started](../getting-started/overview.md)
- [Architecture](../architecture.md): design-time vs run-time paths.
