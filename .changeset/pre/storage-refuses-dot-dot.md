---
'@selvajs/platform': patch
'@selvajs/supabase-provider': patch
---

The Supabase storage provider refuses a path with a `..` segment with a 400 on `get`, `put`, `delete` and `deletePrefix`, as the local provider does. Before, a read of such a path came back as not found. The storage conformance suite checks every method for this under `pathContainment`.
