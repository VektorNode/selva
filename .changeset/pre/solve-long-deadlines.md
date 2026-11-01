---
'@selvajs/solve': minor
'@selvajs/selva': patch
---

A `COMPUTE_SOLVE_DEADLINE_MS` of 300 s or more now works. The solve client sends through a `fetch` without undici's 300 s limits, so the deadline decides, not undici. Below 300 s nothing changes.

The admin compute pages show a stored server URL or API key that can't be used, instead of failing with a 500.

A failed solve logs the Compute request id and the error body's size. The raw body, which can quote what was solved, is logged only at `SELVA_FLAG_COMPUTE_DEBUG=verbose`.
