---
'@selvajs/server': patch
'@selvajs/supabase-provider': patch
---

Fewer sequential round trips on two hot paths.

- `createDefinitionLoader` resolves the definition's compute server while it reads the version and the definition file, instead of after them. A describe that misses the cache waits on two fewer round trips. A definition missing its version or file still fails as `data` before a missing server fails as `missing-config`.
- `SupabaseAuthProvider.verifyToken` in `hybrid` mode checks a symmetric (HS256) token with one GoTrue `getUser`. `getClaims` cannot verify such a token locally and asks GoTrue itself, so the periodic recheck made it two calls.
