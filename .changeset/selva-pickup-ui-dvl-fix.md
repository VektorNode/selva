---
'@selvajs/selva': patch
---

Republish to pick up `@selvajs/ui` 4.12.1: dynamic value list inputs now fall back to the first available option when no selection was ever made, preventing empty-selection solves from cascading null-data errors through definitions and caching geometry-less results.
