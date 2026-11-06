---
'@selvajs/ui': patch
---

A long cloud solve no longer finishes on "Done 0.0 s". The solve status kept restarting its clock on every progress update, so the time it showed only counted since the last one.
