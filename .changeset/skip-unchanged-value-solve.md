---
'@selvajs/solve': patch
---

`session.setValue` no longer solves again when an input is set to the value the last solve already sent. A field that reports its value on input and again on blur used to solve twice, and Grasshopper re-applies every dynamic value list on each update, so the repeat was a real solve. The value still solves when `forceSolve` is passed, after a failed or aborted solve, for file and dynamic value list inputs, and for object values.
