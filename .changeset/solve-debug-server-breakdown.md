---
'@selvajs/solve': patch
'@selvajs/selva': patch
---

With `debug` on, each solve's console line is followed by where the server's time went: the Rhino.Compute call (split into solve, Grasshopper, decode, encode and queue plus network when the server reports it), the steps before the solve, and serializing and compressing the result.
