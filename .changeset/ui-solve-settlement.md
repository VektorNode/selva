---
'@selvajs/ui': minor
---

- `ComputeApp` takes `onSolved(settlement)`, called once per settled solve.
- A `panelActions` entry can set `solvesFirst`: picking it solves when the inputs changed (or waits for a running or held solve), then runs `onclick` with the applied result. A refused or failed solve skips the action; its messages already show. While inputs are stale the item reads "Calculates first" unless it has its own `hint`.
- `useSolveSession` forwards `ensureSolved`, `onSettled` and `reportAborted`; `SolveSettlement` is exported.
