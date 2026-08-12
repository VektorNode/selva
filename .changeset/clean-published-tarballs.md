---
'@selvajs/platform': patch
'@selvajs/server': patch
'@selvajs/schemas': patch
'@selvajs/compute': patch
'@selvajs/local-provider': patch
'@selvajs/supabase-provider': patch
'@selvajs/ui': patch
'@selvajs/cli': patch
---

Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.
