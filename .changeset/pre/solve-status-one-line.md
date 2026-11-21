---
'@selvajs/ui': patch
'@selvajs/selva': patch
---

A slow solve's status stays one line in `AppLayout`'s action row: the step, count, elapsed time and Abort sit beside each other instead of growing into a two-row card over the fields. The Esc hint inside Abort hides when the row is narrow.
