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
| `definitions/shelving-unit.gh`             | Dynamic value lists: bay, shelf and door options computed from the size, each pick checked in the same solve | `scripts/plugin/example-definitions` |
| `definitions/kitchen-run.gh`               | Options By and Repeat: a cabinet per row from the layout, fronts by style, handles by each cabinet's front, all switching in the browser | `scripts/plugin/example-definitions` |
| `definitions/studio-task-lamp.gh`          | Desk lamp configurator: a dynamic light-source list, Night lighting, checks, charts, price, A3 PDF, CSV and 3DM out | `scripts/plugin/example-definitions` |
| `definitions/perforated-facade.gh`         | Attractor perforation, metal finishes, a colour picker, DXF and SVG out  | `scripts/plugin/example-definitions` |
| `definitions/timber-gridshell-pavilion.gh` | Form tiles, materials, night lights, quantities, a chart, PDF drawings, CSV and 3DM out | `scripts/plugin/example-definitions` |
