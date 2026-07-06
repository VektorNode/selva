---
'@selvajs/selva': patch
---

Extend compute timing logs to cover every network leg. The `Server-Timing` header now includes the compute server's own decode/solve/encode plus a derived `compute_link` segment — the traffic + queue time between the Selva server and Rhino.Compute, previously hidden inside the solve wall time. The browser log adds two cross-check lines: the compute-server split, and a network-stack view from the Resource Timing API showing actual bytes on the wire and whether the response was compressed in transit — confirming whether a long download is genuine transfer time.
