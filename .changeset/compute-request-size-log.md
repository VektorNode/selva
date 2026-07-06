---
'@selvajs/selva': patch
---

Log the solve request payload size (total and the `values` share) in the browser compute timing line. A large request body — e.g. a geometry or file input embedded in `values` — pays the same slow uplink as the result download and previously surfaced only as an unexplained slow `body` prep mark on the server.
