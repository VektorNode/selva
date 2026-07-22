---
title: Display
group: Plugin
order: 3
published: true
---

# Display

Controls how Grasshopper geometry appears in the web 3D viewer.

| Component             | Does                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------- |
| **Display**           | Tags geometry for the viewer: what shows up in the browser scene.                             |
| **Three Material**    | Defines the material (color, opacity, metalness…) applied to geometry in the Three.js viewer. |
| **Display To File**   | Saves a display payload to a `.dmf` file for fast reuse (no re-meshing on reload).            |
| **Display From File** | Reloads a display payload from a `.dmf` file.                                                 |

Feed geometry through these to control its appearance before it reaches the UI.

## Next

- [Plugin overview](../plugin/overview.md)
- [File I/O](../plugin/file-io.md)
