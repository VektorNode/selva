---
'@selvajs/selva': patch
---

Add per-segment compute timing logs. The browser now logs a concise round-trip + parse breakdown per solve (always on), and `SELVA_FLAG_COMPUTE_DEBUG` now also emits a `[Compute/server]` line timing the server-side phases the solve metric excludes (definition load, input tree build, response serialization). Together with the existing Rhino.Compute and cache logs, these let you decompose end-to-end solve latency across browser, Selva server, and compute server.
