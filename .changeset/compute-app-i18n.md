---
'@selvajs/ui': minor
---

Extend multi-language (en/de) support to the compute app shell. `<ComputeApp>` now takes a `lang` prop that provides the UI locale to its whole subtree, so the panel layout, calculate/solving controls, collapsed panel strip, and loading/empty states are localized alongside the viewer.

Set the language with the `lang` prop on `<ComputeApp>` (or on a standalone `<Viewer>`), or drive it app-wide via the exported `setLocaleContext`. Defaults to English when unset. Schema-authored labels and Grasshopper-sourced names/metadata are not translated.
