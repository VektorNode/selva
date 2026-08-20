---
'@selvajs/server': patch
---

Stop falling back to a hardcoded tagline when branding sets none.

An unset `brand.tagline` defaulted to "Turn Grasshopper definitions into tools anyone can use.", so a deployment that deliberately wanted no tagline got Selva's marketing copy instead. It now resolves to an empty string, and consumers render nothing.
