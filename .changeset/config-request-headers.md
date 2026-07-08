---
'@selvajs/compute': minor
---

`ComputeConfig.headers` — optional extra headers sent on every solve / IO request.

- Merged UNDER the transport's own headers (`X-Request-ID`, `Content-Type`, `Authorization`, `RhinoComputeKey`) in `buildHeaders`, so a caller can never override auth or the request id.
- Flows through `GrasshopperClient` (config spread untouched by `normalizeComputeConfig`, returned by `getConfig`) into both the `grasshopper` solve endpoint and the `io` endpoint, and through the `SolveScheduler` (which reuses the client config).
- Intended for routing/telemetry hints a reverse proxy or load balancer reads — e.g. a definition-affinity key (`X-Selva-Definition`) so a pool routes repeat solves of one definition to the same VM. A single-node server ignores unknown headers, so it is inert until a router exists.
