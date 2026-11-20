---
'@selvajs/platform': minor
'@selvajs/server': minor
'@selvajs/local-provider': minor
'@selvajs/supabase-provider': minor
'@selvajs/ui': minor
'@selvajs/solve': minor
'@selvajs/selva': minor
---

The values saved in a definition's file are stored on its version (`DefinitionVersion.savedValues`) when it is uploaded, so a page renders them without asking Rhino.Compute, restarts included. A version uploaded before this, or whose read was still running, gets them from Compute once and stores them. `IDefinitionStore` gains `setVersionSavedValues`; Supabase needs the migration `20261120150000_selva_definition_version_saved_values`.

While a page still reads the saved values, it no longer solves on the stored defaults: the calculate button shows "Reading saved values…" and every solve, edits and exports included, waits. `ComputeApp` takes `solveHold` for this; `SolveSession` gains `hold(on)`.
