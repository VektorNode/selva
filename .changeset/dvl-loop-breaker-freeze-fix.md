---
'@selvajs/ui': patch
---

Fix a browser freeze (`effect_update_depth_exceeded`) when a dynamic value list's computed options depend on the current selection. Such a definition oscillates — the empty/stale-selection fallback auto-picks a valid option and force-solves, the next solve returns options that exclude that pick, the effect fires again — looping without a fixed point until Svelte's effect scheduler exhausts its update depth and the tab hangs on every solve. The reconciliation effect now caps consecutive system-initiated auto-picks (reset by any real user selection); once the cap is hit it logs a warning naming the input and stops, keeping the empty-value invariant intact. This makes the UI resilient to a definition that can't produce stable value-list options (e.g. one whose upstream errors null out the option source), turning a hard freeze into a bounded warning.
