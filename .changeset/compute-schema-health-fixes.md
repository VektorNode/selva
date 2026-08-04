---
'@selvajs/server': patch
'@selvajs/selva': patch
---

Fixed two bugs:

- `POST /api/v1/compute/schema` reimplemented compute's fetch/error-mapping logic instead of
  reusing it. Extracted the shared part into `postSchemaFormData` (new export of
  `@selvajs/server/definitions`), used by both the single-file `fetchSchemaFromCompute` and the
  multi-file schema-preview route.
- The admin health check's compute-reachability probe hit `/healthcheck`, a route the
  rhino.compute proxy doesn't have, so it always reported the default server as unreachable. It
  now reuses `ComputeServerStats.isServerOnline()` from `@selvajs/compute`, which probes the
  correct liveness root (`GET /`).
