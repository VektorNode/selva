---
'@selvajs/ui': patch
'@selvajs/selva': patch
---

Move the solve-request values projection into the solve session itself. The session merges solve outputs into the same values map that inputs live in (so widgets like dynamic value lists can read them), and previously dispatched the whole map to the transport — the Selva app filtered it back down in its own onSolve, but any other app built on `@selvajs/ui` would unknowingly re-upload multi-MB output payloads (a measured 6.4 MB options list) on every solve. `dispatch()` now projects values down to schema-input ids before calling the driver, so every transport — HTTP, WebSocket, or custom — gets input-only values by contract, and the app-level filter is removed as redundant.
