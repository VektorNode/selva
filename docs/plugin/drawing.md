---
title: Drawing
group: Plugin
order: 8
published: true
description: 'Build document-model 2D drawings and render them to SVG or PDF from a definition.'
---

# Drawing

A document-model library for 2D drawings — title blocks, dimensions, tables, annotated views — rendered to **SVG** or **PDF**. Reach for it when your app needs fabrication-ready sheets rather than a 3D view alone.

This is the largest feature area in the plugin, so what follows is a map. Each component's own description on the canvas carries the detail.

## How it composes

You build a drawing bottom-up, then render it:

```
elements  →  layout  →  page  →  document  →  Render SVG / Render PDF
```

- **Elements** are the marks: curves, surfaces, text, images, symbols, dimensions.
- **Layout** components arrange them: stacks, grids, frames.
- **Pages** wrap arranged content; a **Document** bundles pages with shared metadata.
- **Render** turns any of those into a file. Render a Document for paginated multi-page output, or wire drawings and views straight in for a single page.

Render SVG and Render PDF produce file outputs. Wire them into a **ContextBake** to make them downloads, exactly like [File I/O](../plugin/file-io.md).

## The components

**Selva → Drawing**

| Group            | Components                                                                 |
| ---------------- | -------------------------------------------------------------------------- |
| Document & pages | Document, Document Info, Page, Layout Override                             |
| Layout           | Frame, Grid, Stack                                                         |
| Views            | Drawing View                                                               |
| Elements         | Draw Curve, Draw Surface, Draw Text, Draw Image, Draw Symbol               |
| Annotation       | Linear Dimension, Angular Dimension, Leader, Text Flow, Table, Title Block |
| Styling          | Path Style, Text Style                                                     |
| Render           | Render SVG, Render PDF                                                     |

**Selva → Layout** — Legend Block, Notes Block, Revision Table.

**Selva → Elements** — the style params: Stroke, Fill, Path Style, Text Style.

## Things that trip people up

- **Grid track sizing.** A number list sizes columns and rows: `>0` is a fixed size in drawing units, `0` is auto, `<0` is a star weight.
- **Drawing View length.** Sets the longest side in mm; leave it at `0` to auto-fit the parent page. One view per input branch.
- **Table rows are a data tree** — one branch per row.
- **Title Block and Document Info work together.** Info supplies `{token}` values that the title block and other chrome resolve.
- **Layout Override** gives you non-default paper, margins, or chrome. Wire it into a Document or a Page.

## Next

- [File I/O](../plugin/file-io.md): delivering rendered sheets as downloads.
- [Plugin overview](../plugin/overview.md)
