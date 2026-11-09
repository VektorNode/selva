# dev

Files a developer loads by hand, in the [viewer lab](../packages/visualization/lab/README.md) or
in a dev server's mock. No test reads them; if one starts to, move the file into that test's
scope. The rules for this folder are in
[STRUCTURE.md](../STRUCTURE.md#test-data-examples-and-dev-scenes), and `node
scripts/develop/check-fixtures.mjs` fails on any file below that this list doesn't name.

## grasshopper/

Definitions for testing the plugin by hand in Rhino.

| File                               | For                                                                               | Regenerate                           |
| ---------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| `csharp-script-component.ghx`      | A C# Script component and no UI Builder: uploads must be refused                  | by hand                              |
| `display-pipeline-debug.ghx`       | Web Display and Context Bake wiring, for debugging the display pipeline           | by hand                              |
| `dynamic-value-list.ghx`           | Dynamic value lists; the worked example in `docs/contributing/plugin-context.md`  | by hand                              |
| `live-solve-showcase.ghx`          | Live solving in the Rhino panel and the bridge's solve events                     | by hand                              |
| `sheet-metal-bracket.ghx`          | A SheepMetal bracket, 45 objects: viewer picking and hotspots on real sheet metal | by hand                              |
| `ui-bridge-minimal.ghx`            | The smallest UI Bridge setup                                                      | by hand                              |
| `stress-display-throughput.gh`     | Up to 40,000 objects, 64 materials and layers, a text payload up to 20 MB         | `scripts/plugin/example-definitions` |
| `stress-every-input-and-output.gh` | Every input widget, visibility rules, a dynamic list, every output kind           | `scripts/plugin/example-definitions` |
| `bench-solve-transport.gh`         | One input per re-solve cost, for `scripts/develop/solve-bench`                    | `scripts/plugin/example-definitions` |

## viewer-scenes/

Recorded solves the viewer lab replays (`pnpm lab --scene <name>`) and `pnpm dev:plugin:mock`
serves. Recordings go stale when their definition changes: record again with `pnpm lab:record`.

| File                   | For                                                            | Regenerate                                                |
| ---------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| `lamp.slvm`            | A desk lamp: emissive materials and the night look             | `pnpm lab:record`, source definition not recorded         |
| `lamp-chrome.slvm`     | The desk lamp in chrome: metal reflection under the night look | `pnpm lab:record`, source definition not recorded         |
| `tower.slvm`           | A tower in a city block: large scenes, frame cost              | `pnpm lab:record`, source definition not recorded         |
| `courtyard.slvm`       | A courtyard block: large scenes, frame cost                    | `pnpm lab:record`, source definition not recorded         |
| `repro-aluminium.slvm` | Aluminium strip with real Part UVs: metal finishes             | written from Rhino through `GrainUvs` and the SLVM writer |
| `repro-sheets.slvm`    | Sheet-metal strips with real Part UVs: grain and anisotropy    | written from Rhino through `GrainUvs` and the SLVM writer |
| `repro-stainless.slvm` | Stainless strip with real Part UVs: metal finishes             | written from Rhino through `GrainUvs` and the SLVM writer |
