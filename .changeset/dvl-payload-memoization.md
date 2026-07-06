---
'@selvajs/ui': patch
---

Memoize dynamic value list payload parsing. In compute mode the options payload arrives as a JSON string — several MB for large option lists — and the options map derives from the live values, recomputing on every value change. Each recompute re-parsed the full string and allocated a fresh options object whose new identity re-rendered the entire dropdown subtree; with a measured 6.4 MB payload this drove the tab out of memory when fast (cached) solve results triggered several recomputes in one frame. Repeated payloads (including identical strings from later solves) now return the same parsed object, so unrelated value changes no longer touch the dropdown at all.
