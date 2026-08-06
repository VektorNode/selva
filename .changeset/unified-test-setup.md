---
'@selvajs/supabase-provider': patch
'@selvajs/local-provider': patch
'@selvajs/visualization': patch
'@selvajs/platform': patch
'@selvajs/schemas': patch
'@selvajs/compute': patch
'@selvajs/server': patch
'@selvajs/solve': patch
'@selvajs/ui': patch
---

Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
build tool would have shipped tests to npm. All publishable packages now carry
the same exclusion.

`@selvajs/platform`'s test suite was never wired to a runner and had never
executed; it now runs with the rest.
