---
'@selvajs/supabase-provider': minor
'@selvajs/local-provider': minor
'@selvajs/selva': minor
'@selvajs/compute': minor
'@selvajs/ui': minor
---

Ship the `getServerApiKey` implementations on both compute-server stores
(`SupabaseComputeServerStore`, `LocalComputeServerStore`).

The method was added to `IComputeServerStore` and both provider sources in the
same commit as the structured-logging work, but neither provider carried a
changeset — so the published `@selvajs/supabase-provider@0.14.4-beta.1` and
`@selvajs/local-provider@0.12.8-beta.1` tarballs (released three days earlier)
predate it, while `@selvajs/platform@0.15.0-beta.2` now publishes the interface
requiring it. Against the published providers, `@selvajs/selva` code paths that
call `store.getServerApiKey(...)` (compute resolve, admin health/status/actions
routes) fail with a runtime `TypeError`, and consumers fail to typecheck the
store against the current platform interface. This release publishes provider
builds that actually carry the method.
