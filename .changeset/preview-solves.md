---
'@selvajs/schemas': minor
'@selvajs/compute': minor
'@selvajs/solve': minor
'@selvajs/server': minor
'@selvajs/ui': minor
'@selvajs/selva': minor
---

Preview solves: a definition can make its files when someone downloads them instead of on every edit. The UI schema gains `previewSolves` (schema 2.20.0, off when absent), set by the builder's "Make files on download" switch. With it on, the page solves each edit as a preview, and the plugin skips the file components whose only consumers are Download outputs. The outcome lists those outputs as `deferred`, and a click on Download runs one full solve of the inputs on screen.

`SolveOptions`, `SchedulerSolveOptions` and `GrasshopperComputeConfig` gain `solveMode` (`SolveMode`: `'preview' | 'full'`), sent to compute as `selvamode` for a preview only; the scheduler's cache key includes it. `SolveEngineSolveArgs.solveMode` is part of the single-flight key. `SolveBodySchema` gains `mode`, default `full`. `SolveOutcome` and `SolveResult` gain `deferred`. A `SolveFn` takes an optional third argument, `SolveCallOptions`. `SolveDriver.solve` takes `{ solveMode }`, and the new optional `solveFiles` runs the download solve outside the session. `SolveSession` gains `files`, `makeFiles()` and `cancelFiles()`. `OutputDisplay` reads them from a context `ComputeApp` sets. Needs the VektorNode compute fork 9.11.0 and a matching Selva plugin. Anything older ignores the mode and solves in full.
