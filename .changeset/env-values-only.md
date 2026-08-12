---
'@selvajs/cli': minor
---

Scaffold a values-only `.env`, and let `selva doctor --fix` strip an existing one.

The annotated `.env` is useful while you decide what to set and useless once it
is on a server: `migrate` rewrites keys but never prose, so a deployment keeps
documenting the release it was installed at — describing variables the code has
since renamed or retired. A 4.6-era file is ~470 lines of instructions, most of
them now wrong, wrapped around ~14 real settings.

`create` and `init` now write values only, under a header pointing at the
runtime template (`node_modules/@selvajs/selva/templates/.env.example`), which
is refreshed on every update and stays authoritative. The template itself is
unchanged and still ships annotated.

`selva doctor` reports a `.env` still carrying the shipped documentation and
offers to strip it under `--fix`. Comments an operator wrote directly above a
setting are kept; the repair refuses if any setting would change value, and
writes `.env.bak` first.
