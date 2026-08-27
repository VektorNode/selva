---
'@selvajs/compute': patch
'@selvajs/solve': patch
'@selvajs/selva': patch
'@selvajs/server': patch
---

Fix solve failures that surfaced as a bare HTTP 500 with no diagnosis, and tighten error handling across the compute stack.

**Solve failures are now classified instead of collapsing to 500.** The solve pipeline only recognised a raw `AbortError` as a timeout or disconnect, but the scheduler rejects with `ComputeError` (`TIMEOUT_ERROR` / `ABORTED`) — so every real solve deadline and client disconnect fell through to a generic 500. The same mismatch hid an unreachable compute server: the route matched a raw `TypeError('fetch failed')`, which the transport wraps into `ComputeError` `NETWORK_ERROR` before it gets there. Deadlines now return 504, disconnects 499, and unreachable/rate-limited/rejected-credentials servers return 503 with a message naming which one it was. Only a genuine solve failure stays 500.

**Server logs carry the compute server's own error body.** `renderThrown` dropped `code` and `statusCode`; it now appends a `[code=… status=…]` tag, and the solve failure log includes the raw (bounded) compute response body — often the only diagnostic that survives when the compute server scrubs exception messages in production mode.

**The browser stopped discarding the server's explanation.** `createComputeFetchSolveFn` hard-coded "offline or unreachable" for any 503 without reading the body; it now shows the server's message on 503 and 504.

**Wire-casing fixes in `@selvajs/compute`.** Three error-handling decisions read `values`/`errors` case-sensitively while the rest of the package reads them case-insensitively, so a PascalCase response from a stock mcneel server was misjudged: a partial success was discarded as a hard failure, `client.solve()` passed an errored response through as clean success, and `cacheErroredSolves: false` cached errored solves anyway. All three now use `readField`.

**Other correctness and consistency fixes in `@selvajs/compute`:**

- `fetchCompute` guards `JSON.stringify` — a circular or BigInt payload threw a raw `TypeError` instead of the documented `ComputeError`.
- New `ComputeServerStats.probeServer()` reports probe status and connection error; `GrasshopperClient.create()` uses it so a 401/403 says the credentials were rejected rather than "server is not online".
- `monitor()` and `TreeBuilder.parsePathString` throw `ComputeError` instead of `RangeError` / plain `Error`, so `instanceof ComputeError` holds across the whole public surface.
- A ValueList default absent from its values map now reaches `parseErrors` instead of only the logger.
- HTTP 400 maps to `VALIDATION_ERROR` (was `UNKNOWN_ERROR`); the missing-base64-codec throws use `ENVIRONMENT_ERROR` (was `INVALID_STATE`); 502 is labelled "Bad gateway".
- Removed an unreachable catch in `extractFilesFromComputeResponse`, and corrected the `RATE_LIMIT` doc that claimed retries happen by default (`attempts` defaults to 0).
