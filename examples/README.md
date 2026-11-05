# examples

Grasshopper definitions for people learning Selva; the website links this folder. Each one must
open and solve against the current plugin release. No test reads them. The rules for this folder
are in [STRUCTURE.md](../STRUCTURE.md#test-data-examples-and-dev-scenes), and `node
scripts/develop/check-fixtures.mjs` fails on any file below that this list doesn't name.

| File                                       | Shows                                                                    | Regenerate                    |
| ------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------- |
| `file-import-example.3dm`                  | Not yet described                                                        | by hand                       |
| `definitions/block-massing-studio.gh`      | Massing in a city block: stone, timber and metal finishes, paving, a Canopy floor-area chart, the night look | by hand                       |
| `definitions/canopy-example.gh`            | Not yet described                                                        | by hand                       |
| `definitions/display-example.gh`           | Not yet described                                                        | by hand                       |
| `definitions/dynamic-value-list.gh`        | Dynamic value lists                                                      | by hand                       |
| `definitions/file-example.gh`              | Not yet described                                                        | by hand                       |
| `definitions/point-attractor.gh`           | Not yet described                                                        | by hand                       |
| `definitions/studio-task-lamp.gh`          | A desk lamp with emissive materials for the night look                   | by hand                       |
| `definitions/perforated-facade.gh`         | Attractor perforation, metal finishes, a colour picker, DXF and SVG out  | `scripts/plugin/example-definitions` |
| `definitions/timber-gridshell-pavilion.gh` | Form tiles, materials, night lights, quantities, a chart, PDF drawings, CSV and 3DM out | `scripts/plugin/example-definitions` |
