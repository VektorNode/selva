---
'@selvajs/cli': minor
'@selvajs/selva': minor
'@selvajs/compute': minor
'@selvajs/platform': minor
'@selvajs/local-provider': minor
'@selvajs/supabase-provider': minor
'@selvajs/schemas': minor
'@selvajs/server': minor
'@selvajs/solve': minor
'@selvajs/ui': minor
'@selvajs/visualization': minor
---

The supported Node floor moves from 22 to 24.

Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
`engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

**This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
reported as out of range today. Nothing about the deployment changed — the floor moved under it.
Upgrade the host's runtime before taking this version of the CLI.

The admin UI's update check reports the same thing from the other direction: it compares the
running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
`url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
and every dependency's own engine range already admitted 24.
