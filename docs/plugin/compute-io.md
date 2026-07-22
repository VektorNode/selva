---
title: Compute I/O
group: Plugin
order: 5
published: true
---

# Compute I/O

Interactive inputs that the web UI drives and feeds back into the definition.

| Component                        | Does                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Get Value List**               | Exposes a dropdown / selection list as a web control.                                                                                    |
| **Get / Set Dynamic Value List** | A value list whose options are computed at run time: **Set** publishes the options from the definition, **Get** reads the user's choice. |
| **Get Color**                    | Exposes a color picker input.                                                                                                            |
| **Get File**                     | Accepts an uploaded file from the web UI.                                                                                                |
| **Get Image**                    | Supplies an image from the web UI (path, URL, or upload).                                                                                |
| **Get Server File**              | Imports geometry from a file in the server's data directory.                                                                             |
| **Environment**                  | Surfaces run-time environment info to the definition.                                                                                    |

These are how a user's choices in the browser become inputs to the solve.

## Next

- [Plugin overview](../plugin/overview.md)
- [Drawing](../plugin/drawing.md)
