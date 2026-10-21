---
'@selvajs/compute': minor
---

Three fixes in the solve path:

- A timeout or caller abort that fires while a response body is still downloading now rejects with `TIMEOUT_ERROR` or `ABORTED`. Before, it surfaced as a retryable `NETWORK_ERROR` "Failed to parse JSON response", so a solve that hit its deadline mid-download read as a compute failure.
- `TreeBuilder.fromInputParams` expands a list-access input's default (`atMost > 1` without tree access) into its branches. Before, the whole tree was sent to Grasshopper as a single JSON string item.
- `GrasshopperClient.create()` authenticates its liveness probe with the client's `authToken`, `apiKeyHeader` and `headers`, not only `apiKey` under `RhinoComputeKey`. A server behind a token-checking gateway no longer fails `create()` with a 401. `ComputeServerStats` takes these fields as its second argument (`ComputeAuth`, exported from `/core`); passing a plain API key string still works.
