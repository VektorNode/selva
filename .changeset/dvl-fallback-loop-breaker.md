---
'@selvajs/ui': patch
---

Bound the dynamic value list auto-pick fallback to 3 consecutive system-initiated picks (reset by any real user selection). A definition whose computed options depend on the current selection could oscillate — auto-pick → force-solve → new options invalidate the pick → auto-pick again — force-solving in an unbounded loop that can run the tab out of memory. The fallback now stops with a console warning identifying the input instead of looping.
