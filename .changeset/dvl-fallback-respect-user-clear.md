---
'@selvajs/ui': patch
---

Refine the dynamic value list empty-selection fallback: it now only fills a selection that was never made. A user who deliberately clears the selection (e.g. unchecks every checklist entry) is no longer fought by the auto-fallback re-selecting the first option.
