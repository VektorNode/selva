---
'@selvajs/selva': patch
---

Add a result-health line to the browser solve log: how many schema outputs came back populated, which are empty (by nickname), and the solve's Grasshopper error/warning counts with the first error inline. An abnormally fast solve that returns no geometry — e.g. a stale dynamic value list selection killing the heavy branch — is now diagnosable from the console instead of appearing as an unexplained empty viewer.
