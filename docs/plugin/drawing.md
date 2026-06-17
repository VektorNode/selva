---
title: Drawing
group: Plugin
order: 6
published: true
---

# Drawing

A document-model drawing library for producing 2D drawings (title blocks, dimensions, tables, legends) rendered to **SVG** or **PDF**.

This is the largest feature area. You compose a drawing from a document model and render it: pages, frames, grids, text flows, dimensions (linear, angular), tables, revision and title blocks, path/text styles.

| Group                 | Components                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| **Document & layout** | Document, Page, Frame, Grid, Stack, Layout Override                                                  |
| **Annotation**        | Linear / Angular Dimension, Text Flow, Notes Block, Title Block, Legend Block, Revision Table, Table |
| **Geometry**          | Create Curve, Create Surface, Create Text                                                            |
| **Styling**           | Path Style, Text Style                                                                               |
| **Render**            | Render SVG, Render PDF                                                                               |

Use Drawing when your app needs to emit fabrication-ready sheets or documentation, not just a 3D view.

## Next

- [Plugin overview](../plugin/overview.md)
- [File I/O](../plugin/file-io.md): deliver rendered drawings as downloads.
