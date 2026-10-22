---
'@selvajs/compute': major
---

Security and performance hardening. What changes for a caller:

- **Redirects are not followed.** fetch keeps a custom API key header such as `RhinoComputeKey` across origins, so following a redirect handed the key to its target. A 3xx now rejects with `INVALID_CONFIG`, naming the target in `context.location`: set `serverUrl` to that address. `ComputeServerStats` reads return `null` on a redirect. The liveness probe still reads one as online.
- **Solve-cache keys are SHA-256.** The 32-bit FNV-1a key could be collided on purpose in milliseconds, so one user of a shared scheduler could choose what another user's solve returned. `hashSolveInput` and `hashDefinition` return a new format (`s:`, `u8:` or `r:` part, then `|t:` and 64 hex chars), so a durable cache keyed by them misses once. `stableStringify` marks non-JSON values with tokens no JSON value produces (`{u8:…}`, `{map:[…]}`, `{set:[…]}`, `[Circular]`), and stringifies a function like `undefined`.
- **`fetchCompute`, `solveGrasshopperDefinition` and `fetchDefinitionIO` validate `serverUrl`**, throwing `INVALID_CONFIG` before any request. The two Grasshopper functions also refuse `compute.rhino3d.com`, as `GrasshopperClient` does.
- Scheduler `SUPERSEDED`, `ABORTED`, `QUEUE_FULL` and `QUEUE_TIMEOUT` errors no longer carry `context.key`. Read `ctx.key` in a hook instead.

Added:

- `ComputeConfig.maxResponseBytes`. The download is cancelled once the body passes it, rejecting with the new `RESPONSE_TOO_LARGE`. A solve doesn't count the uploaded definition the server echoes back. An error body other than a 500 is read only up to 1 MB.

Fixed:

- `getValues` returns an output named `constructor`, `toString` or `__proto__` as its value. It returned `[ƒ, value]`, or swapped the result's prototype. `normalizeUISchemaCasing` and input-default normalization keep a `__proto__` key as data.
- A downloaded archive keeps a root file named `__proto__`, as `__proto__-2`. It was dropped.
- `TreeBuilder` appends branches of any length. Around 150k items it threw `RangeError`.
- When the cache or a hook needs the key, `scheduler.solve()` rejects an input too deep to hash with `INVALID_INPUT`. It threw synchronously.

Faster:

- With the cache off and no hooks, the scheduler doesn't hash the input tree. A string definition re-sent unchanged is hashed once, not on every solve.
- Aborting a queued solve is constant-time; aborting n of them was quadratic.
- `decodeBase64ToBinary` in Node is about 4× faster on large payloads, and returns a large result without copying it.
- `validateServerUrl` trims trailing slashes and dots in linear time.
