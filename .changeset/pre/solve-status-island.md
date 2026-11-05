---
'@selvajs/ui': minor
---

The solve status in `AppLayout`'s action row grows with the solve instead of appearing and disappearing. At rest it reads "Up to date", and a solve too short to show makes its dot ping once. Past 400 ms it becomes "Solving 0.6 s", and past 2 s a card with the current step, a progress bar and Abort, growing upward over the fields so the footer keeps its height. A solve that was shown ends on "Done · 3.4 s". The viewer no longer dims its model or runs a line along its bottom edge while solving.

- `AppLayout` takes `live` and `onabort` for the card's progress and Abort, and `freezesDuringSolve` (as passed to `createSolvingIndicator`), which makes the status say Esc aborts instead of counting seconds.
- `SolveMessages` takes `progressShownByHost`: its live view then shows only the messages a solve sends, leaving progress and Abort to the action row. Pass it when the definition solves on change (`schema.instanceSolve !== false`); with a Calculate button there is no solve status, so `SolveMessages` keeps showing progress.
- `Viewer`'s `isSolving` and `isSlow` are deprecated and ignored.
