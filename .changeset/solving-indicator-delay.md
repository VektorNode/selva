---
'@selvajs/ui': minor
'@selvajs/plugin-ui': patch
---

A solve that ends within 400 ms no longer shows a solving indicator. Once shown, the indicator stays for at least 500 ms so it never flashes. `createSolvingIndicator` replaces its averaged adaptive delay with this fixed rule, so a slow solve after a run of fast ones is no longer left without an indicator, and it now also returns `slow` (past 2 s). The viewer shows a thin progress bar along its top edge instead of blurring the model on every solve, and dims the stale result only while a solve is slow (`Viewer` `isSlow`, `AppLayout` `solveIsSlow`). `AppLayout` now hides the solving chip itself when the definition has a Calculate button, so hosts pass `createSolvingIndicator(...).show` without that check. In a host that freezes while it solves (the Rhino panel), the indicator shows on every solve, since a delay can't run there. In the panel, a value update held back during a solve now also shows the indicator for the solve it starts.
