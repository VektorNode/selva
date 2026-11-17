---
'@selvajs/platform': minor
'@selvajs/selva': patch
---

`SolveFailureKind` gains `request_too_large`, for a solve whose request body the compute server refused. The Selva app records it instead of dropping the metric.
