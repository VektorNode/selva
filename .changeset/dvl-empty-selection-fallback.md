---
'@selvajs/ui': patch
---

Dynamic value list inputs now fall back to the first available option when no selection was ever made (empty string or empty checklist), not only when a previous selection went stale. An empty selection solved as an empty string, cascading through definitions as null-data errors ("File not found", Text→Number conversion failures) and producing geometry-less results that the solve caches then replayed.
