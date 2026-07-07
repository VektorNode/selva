---
'@selvajs/selva': patch
---

Dynamic value list selections now actually reach Rhino.Compute. The solve route's input transform delegates to `processInput`, which has no `dynamicValueList` handler — the input fell to the Geometry fallback with a null default and `TreeBuilder.fromInputParams` silently dropped it, so the definition always solved on the param's own server-side fallback (wired seed option or empty string) regardless of what the user picked. Empty fallbacks cascaded as null geometry into downstream components ("Object reference not set" on e.g. Bounding Rectangle) and nulled every output beyond them. `dynamicValueList` now maps to the ValueList wire contract, matching the plugin's `GetDynamicValueListParameter` (`TypeName = "ValueList"`), so the selection rides the solve request like any static value list. Also restores array defaults (multi-select/checklist values) that `processInput` drops as malformed, which would have omitted those inputs the same way.
