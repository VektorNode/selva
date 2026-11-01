---
'@selvajs/supabase-provider': patch
---

Saving a definition with no tags no longer fails on Supabase. The edit drawer sends `tags: null`, which hit the `not null` column and returned a 500. The store now writes an empty array.
