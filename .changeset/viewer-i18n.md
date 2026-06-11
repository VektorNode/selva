---
'@selvajs/ui': minor
---

Add multi-language (en/de) support to the Viewer and its panels. The viewer chrome — tools menu, view presets, scene manager, and metadata dialog — is now localizable. Set the language with the new `lang` prop on `<Viewer>`, or drive it app-wide via the exported `setLocaleContext`. Defaults to English when unset. Grasshopper-sourced names and metadata are not translated.
