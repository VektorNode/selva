---
'@selvajs/platform': patch
'@selvajs/server': patch
'@selvajs/supabase-provider': patch
---

Trailing `/` and `=` are stripped from config values with a loop instead of a regex, which backtracked quadratically on a long run of either character.
