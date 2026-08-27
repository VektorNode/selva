---
'@selvajs/compute': minor
'@selvajs/solve': patch
'@selvajs/selva': patch
---

Fail fast when a compute server is unreachable, instead of waiting out the retry budget.

A liveness probe now reports _why_ it failed, and callers stop retrying the failures that
cannot resolve themselves. Previously a powered-off compute VM and a booting one were
indistinguishable from a single probe, so both paid the full retry window.

- New `classifyProbeFailure()` in `@selvajs/compute/core` turns a `probeServer()` result into
  a verdict (`refused`, `dns`, `timeout`, `unauthorized`, `http_error`, `unknown`) plus a
  `retryable` flag and an operator-facing summary.
- `GrasshopperClient.create()` stops its retry ladder on a non-retryable verdict and bounds
  each probe at 2s rather than 5s. A refused connection or a rejected API key now fails in
  one probe instead of three; the thrown `ComputeError` carries `context.probeVerdict`.
- `@selvajs/solve`'s client cache remembers a failed build for 5s, so repeated solves against
  a down server replay the original error instead of re-running the probe ladder each time.
  `evict()` clears it, so correcting a server's URL or key takes effect immediately.
- `/api/admin/compute/status` returns `retryable`, `failureReason`, and `failureSummary`. The
  admin panel's health pill stops polling a server that reported a terminal failure and shows
  the reason ("Connection refused — …") instead of a bare "Offline" after 60s of spinning.
