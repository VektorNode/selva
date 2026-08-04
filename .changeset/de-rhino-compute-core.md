---
'@selvajs/compute': major
---

**`@selvajs/compute/core` is now backend-agnostic** — it names no Rhino concept, so a second
backend inherits its retry, backoff, abort-composition, `Retry-After` and status→code machinery
for free.

Two exports changed subpath:

```diff
-import { ComputeServerStats } from '@selvajs/compute/core';
+import { ComputeServerStats } from '@selvajs/compute/grasshopper';
```

`ComputeServerStats` is pure rhino.compute control plane (`/activechildren`,
`/plugins/gh/installed`, `/idlespan`), so `/core` was the wrong home. The inverse move:
`DefinitionRef`, `SolveDefinition` and `isDefinitionRef` are bytes-or-a-lazy-byte-ref with nothing
Grasshopper in them, and they sit in the solve port's own signature — they now export from
`/core` as well as `/grasshopper`, so a second backend's author isn't forced to import them from
the Grasshopper subpath. `RhinoModelUnit` moved from `/core` to `/grasshopper`.

There is no root-barrel fallback for either move — the root entrypoint is deliberately empty in
this same release (see the vocabulary-rename changeset), so every import states its subpath.

Three new seams carry what used to be hardcoded in core:

- **`ComputeConfig.apiKeyHeader`** — the auth header's name, defaulting to `RhinoComputeKey`. The
  key still merges over `config.headers`, so a caller can't clobber whichever header carries it.
- **`ComputeConfig.serverErrorCodes`** — a backend's machine wire codes mapped to our
  `ErrorCodes`, outranking the status-based mapping (type `ServerErrorCodeMap`). Core no longer
  hardcodes `definition_not_cached`; the Grasshopper client supplies it on every request, so
  `ErrorCodes.DEFINITION_NOT_CACHED` still surfaces exactly as before.
- **`validateServerUrl(url, { blockedHosts })`** — the shared public endpoint to reject, still
  defaulting to `compute.rhino3d.com`. Now exported from `/core` alongside `DEFAULT_BLOCKED_HOST`
  and the options type `ValidateServerUrlOptions`.

Nothing above changes behaviour for an existing caller: every new field is optional and defaults to
what core did before. Only the two subpath moves require an edit.
