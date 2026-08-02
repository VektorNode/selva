---
'@selvajs/solve': minor
'@selvajs/ui': minor
---

Make the reported `SolveResult` reachable from a `ComputeApp` host, so a commit path can pair the
artifact it persists with the inputs that produced it.

`source` and `values` travel correctly through the request/response driver's memo, but stopped at the
session: `applySolveResult` merged `outputs` and discarded the rest, and `ComputeApp`'s only outbound
seam was `onReady({ loadValues })`. So a host wanting the pair had to capture it inside its own
`SolveFn` — which a memo hit never calls. Solve A, solve B, scrub back to A: the memo serves A, the
viewer shows A, and the host commits B's geometry.

`SolveSession` now exposes `lastResult: RetainedSolveResult | null` — the last reported result minus
its meshes — and `ComputeApp` hands out `getLastResult()` alongside `loadValues`. Because the session
fills it in `report()`, a memo hit populates it exactly like a fresh solve.

Meshes are dropped from the retained slice rather than kept: they are GPU-backed and the viewer
disposes what it renders on the next scene update, so retaining them would hand out disposed
instances with no policy governing them. Live meshes stay on `session.meshes`. `rebuild()` nulls
`lastResult` for the same reason it clears the driver memo; `reportError` deliberately leaves it, as
the viewer still shows the geometry that produced it.

`values` remains driver-supplied and absent on push transports (the plugin's WebSocket driver cannot
attribute an unsolicited frame to a request) — documented on `SolveDriver` and `SolveResult`.
