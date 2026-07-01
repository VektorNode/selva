---
'@selvajs/selva': minor
---

Run or preview any historical definition version. The versioning tab's "Run" action can now open the runner against an arbitrary version — not just the live/draft channel pointer — via a `?version=` param, and the compute route accepts a matching `versionId`. Explicit-version runs are editor-only and never accessible through share tokens, and the runner shows a "vN preview" badge.
