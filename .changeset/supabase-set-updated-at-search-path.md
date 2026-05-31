---
'@selvajs/supabase-provider': patch
---

Pin `selva.set_updated_at()` to an empty `search_path` via a new migration, resolving the Supabase linter `function_search_path_mutable` warning.
