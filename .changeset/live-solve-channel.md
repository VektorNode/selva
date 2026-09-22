---
'@selvajs/schemas': minor
'@selvajs/compute': minor
'@selvajs/solve': minor
'@selvajs/ui': minor
'@selvajs/selva': minor
'@selvajs/cli': minor
---

Live solve channel: a `SolveEvent` envelope carried over the plugin WebSocket locally and over
SSE from the Selva server in cloud mode, fed on Compute by a callback the plugin POSTs to
mid-solve. The callback reply carries an abort flag back into the running solve. Schema version
2.15.0 (codegen-only, nothing to migrate).
