---
title: File I/O
group: Plugin
order: 7
published: true
description: 'Produce files the deployed app can offer for download.'
---

# File I/O

Reach for these when your definition should hand the user something to download — a cut sheet, a 3D export, a CSV of quantities — alongside the live 3D view.

## The pattern

All four producers work the same way. Each emits a _File_ output; wire that into a **ContextBake** and it becomes a download in the web app. No ContextBake, no download.

| Component            | Produces                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| **Create File**      | A file from text or base64 data — CSV, JSON, a report, anything.                                     |
| **Geometry To File** | Geometry exported with layer names and colours. Single file from a list, multiple files from a tree. |
| **Block To File**    | Rhino block instances as `.3dm` (default) or `.stp`.                                                 |
| **File From Path**   | A file that already exists on disk, wrapped as a Selva output.                                       |

All four also take:

- `Sub Folder` — optional path to organise downloads.
- `Metadata` — optional `Key=Value` strings carried with the file.

Most take a name and, where it makes sense, an extension or format.

## Bake Files

The odd one out. It produces no download; it writes files to a folder on disk. Feed it `Files`, a base path, and a `Bake` boolean to trigger it. Out come the paths written and a status message.

This is an authoring convenience, so you can check your exports are correct without deploying anything. It is not part of the run-time path.

## Next

- [Drawing](../plugin/drawing.md): rendered sheets are file outputs too.
- [Display](../plugin/display.md): the other kind of output.
- [Plugin overview](../plugin/overview.md)
