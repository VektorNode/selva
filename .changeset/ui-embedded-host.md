---
'@selvajs/ui': minor
---

`createSolvingIndicator` and `SolveMessages` take `freezesDuringSolve` for a host that can't repaint while it solves, such as a WebView inside Rhino: the indicator shows for every solve with no delay, and the live progress panel, which could only appear after the solve, gives way to an "Esc aborts the solve" hint. An empty `footerText` now hides the footer's copyright line. `AppLayout` takes `solvingIndicatorPlacement: 'inline'` to show the solving state as a chip in its action row instead of floating it over the bottom-left corner. `SolveMessages` takes `placement: 'inline'` to sit in the flow instead of floating over the page, and `AppLayout` renders it above the action row through its `solveMessages` snippet.
