---
'@selvajs/solve': minor
---

- A solve now tells you how it ended. `session.solve()` returns a promise of a `SolveSettlement` (`applied`, `discarded`, `blocked`, `aborted` or `failed`), `session.onSettled(listener)` reports every solve including the ones input changes start, and `session.ensureSolved()` answers from the result on screen or solves only when it must. A result held for review settles on `acknowledge()` or `discard()`; one a queued solve replaces never settles. The promise never rejects, and `rebuild()` and `dispose()` resolve a waiting one as `aborted`.
- `SolveReporter` gains `reportAborted()`, and `SolveDriver` an optional `hasQueued`. Every solve a driver is asked for must end in exactly one report.
- The request/response driver no longer goes quiet on a stopped solve: a cancel reports `aborted`, and a solve past its deadline reports the error "The solve took longer than N s and was stopped." instead of leaving the user with nothing.
